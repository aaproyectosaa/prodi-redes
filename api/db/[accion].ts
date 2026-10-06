// Datos para la app (reemplaza al acceso directo a Firestore desde el navegador).
//
// POST /api/db/consultar { consultas: [ { ruta } | { coleccion, filtros, orden, limite } ] }
// POST /api/db/escribir  { ops: [ { tipo: "set"|"update"|"create"|"delete", ruta, data?, merge? } ] }  (todo o nada)
// POST /api/db/cambios   { desde }  → qué colecciones cambiaron desde la última vez (para refrescar en vivo)
//
// Cada documento pasa por las reglas de acceso de api/_lib/reglas.ts.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { aplicarEscritura, ejecutarConsulta, enTransaccion, getPool, leerDoc, partirRuta, type Consulta, type OpEscritura } from "../_lib/db";
import { claveProhibida } from "../_lib/docs";
import { contexto, paraLaApp, partirColeccion, puedeEscribir, puedeLeer } from "../_lib/reglas";
import { body, HttpError, requireCaller, sendError } from "../_lib/http";

const MAX_CONSULTAS = 40;
const MAX_OPS = 450;

interface PedidoConsulta {
  ruta?: string;
  coleccion?: string;
  filtros?: { campo: string; op: string; valor: unknown }[];
  orden?: { campo: string; dir: "asc" | "desc" }[];
  limite?: number | null;
}

const COLECCION_OK = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)?$/;
const ID_OK = /^[^/\s]{1,200}$/;

/** Rechaza claves como "__proto__" en cualquier nivel (también dentro de rutas "a.b.c"). */
function validarClaves(v: unknown, prof = 0): void {
  if (prof > 50) throw new HttpError(400, "Datos demasiado anidados");
  if (Array.isArray(v)) return v.forEach((x) => validarClaves(x, prof + 1));
  if (!v || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v)) {
    if (k.split(".").some(claveProhibida)) throw new HttpError(400, "Clave no permitida");
    validarClaves(x, prof + 1);
  }
}

function validarColeccion(col: unknown): string {
  if (typeof col !== "string" || !COLECCION_OK.test(col)) throw new HttpError(400, "Colección inválida");
  return col;
}

async function consultar(req: VercelRequest) {
  const caller = await requireCaller(req);
  const { consultas } = body<{ consultas?: PedidoConsulta[] }>(req);
  if (!Array.isArray(consultas) || consultas.length > MAX_CONSULTAS) throw new HttpError(400, "Consultas inválidas");
  const pool = getPool();
  const ctx = await contexto(pool, caller.uid, caller.role);
  const resultados = await Promise.all(
    consultas.map(async (q) => {
      try {
        if (q.ruta) {
          const { coleccion, id } = partirRuta(q.ruta);
          validarColeccion(coleccion);
          const data = await leerDoc(pool, coleccion, id);
          if (!(await puedeLeer(ctx, coleccion, id, data))) return { error: "permission-denied" };
          return { doc: data ? { id, data: paraLaApp(data) } : null };
        }
        const coleccion = validarColeccion(q.coleccion);
        const c: Consulta = {
          coleccion,
          filtros: (q.filtros ?? []).map((f) => ({ campo: String(f.campo), op: f.op as Consulta["filtros"][number]["op"], valor: f.valor })),
          orden: (q.orden ?? []).map((o) => ({ campo: String(o.campo), dir: o.dir === "desc" ? "desc" : "asc" })),
          limite: q.limite ?? null,
        };
        const filas = await ejecutarConsulta(pool, c);
        const visibles = [];
        for (const f of filas) if (await puedeLeer(ctx, coleccion, f.id, f.data)) visibles.push({ id: f.id, data: paraLaApp(f.data) });
        return { docs: visibles };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Error" };
      }
    })
  );
  return { resultados };
}

interface PedidoOp {
  tipo: OpEscritura["tipo"];
  ruta: string;
  data?: Record<string, unknown>;
  merge?: boolean;
}

async function escribir(req: VercelRequest) {
  const caller = await requireCaller(req);
  const { ops } = body<{ ops?: PedidoOp[] }>(req);
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) throw new HttpError(400, "Escrituras inválidas");
  await enTransaccion(async (cli) => {
    const ctx = await contexto(cli, caller.uid, caller.role);
    for (const o of ops) {
      if (!["set", "update", "create", "delete"].includes(o.tipo)) throw new HttpError(400, "Escritura inválida");
      const { coleccion, id } = partirRuta(String(o.ruta));
      validarColeccion(coleccion);
      if (!ID_OK.test(id)) throw new HttpError(400, "Id inválido");
      const data = o.tipo === "delete" ? {} : o.data;
      if (o.tipo !== "delete" && (!data || typeof data !== "object" || Array.isArray(data))) throw new HttpError(400, "Datos inválidos");
      validarClaves(data);
      const op = { tipo: o.tipo, coleccion, id, data: data ?? {}, merge: !!o.merge } as OpEscritura;
      await aplicarEscritura(cli, op, async (antes, despues) => {
        if (!(await puedeEscribir(ctx, coleccion, id, antes, despues))) {
          throw new HttpError(403, `No tenés permiso para ${despues ? (antes ? "modificar" : "crear") : "borrar"} esto (${partirColeccion(coleccion).base})`);
        }
      });
    }
  });
  return { ok: true };
}

/** Qué colecciones cambiaron. `rev` es la marca para la próxima vez (con margen por si algo se estaba guardando). */
async function cambios(req: VercelRequest) {
  await requireCaller(req);
  const { desde } = body<{ desde?: number | null }>(req);
  const pool = getPool();
  if (desde == null || !Number.isFinite(Number(desde))) {
    const r = await pool.query("select coalesce(max(rev), 0)::bigint as rev from documentos where actualizado < now() - interval '3 seconds'");
    const b = await pool.query("select coalesce(max(rev), 0)::bigint as rev from borrados where borrado < now() - interval '3 seconds'");
    return { rev: Math.max(Number(r.rows[0].rev), Number(b.rows[0].rev)), colecciones: [] };
  }
  const r = await pool.query(
    `with c as (
       select coleccion, rev, actualizado as t from documentos where rev > $1
       union all
       select coleccion, rev, borrado as t from borrados where rev > $1
     )
     select coleccion, max(rev) as rev, bool_and(t < now() - interval '3 seconds') as viejo from c group by coleccion`,
    [Number(desde)]
  );
  // La marca avanza solo hasta lo que ya está seguro (más de 3 s): lo reciente se vuelve a avisar una vez.
  let rev = Number(desde);
  const cols = new Set<string>();
  for (const row of r.rows as { coleccion: string; rev: string; viejo: boolean }[]) {
    const p = partirColeccion(row.coleccion);
    cols.add(p.sub ? `${p.base}/*/${p.sub}` : p.base);
    if (row.viejo) rev = Math.max(rev, Number(row.rev));
  }
  if (r.rows.length && (r.rows as { viejo: boolean }[]).every((x) => x.viejo)) rev = Math.max(rev, ...r.rows.map((x: { rev: string }) => Number(x.rev)));
  return { rev, colecciones: [...cols] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const accion = String(req.query.accion ?? "");
    if (accion === "consultar") res.status(200).json(await consultar(req));
    else if (accion === "escribir") res.status(200).json(await escribir(req));
    else if (accion === "cambios") res.status(200).json(await cambios(req));
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    const status = (err as { code?: number }).code;
    if (status === 5 || status === 6) res.status(409).json({ error: (err as Error).message });
    else sendError(res, err);
  }
}
