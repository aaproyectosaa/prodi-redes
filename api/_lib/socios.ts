// Socios comerciales: gente de afuera (o del equipo) que trae clientes y cobra comisión.
//
// - Cada socio tiene en su perfil `socio: { codigo, comision_pct, meses }` (lo carga el admin en Equipo). Sin
//   porcentaje o sin meses no se calcula comisión: se avisa al admin (no hay valores por defecto).
// - Sus leads llevan `socio_id` (por su link somosprodi.com/?ref=CODIGO o cargados desde su panel). Si el lead ya
//   existía, queda para quien lo trajo primero.
// - El cliente que sale de un lead suyo queda con `socio_id` y `socio_alta` (fecha de alta).
// - Comisión: SOLO sobre lo cobrado (boletas cobradas en el mes), sobre el abono neto sin IVA (los ítems REDES),
//   sin la pauta de Meta ni reintegros (que van como EXTRAS), y solo los meses configurados desde el alta.
//   Se paga a mes vencido, como el resto del equipo (Pagos al equipo → equipo_liquidaciones).

import { adminDb, getPool } from "./db";
import { HttpError } from "./http";
import { enviarAviso } from "./notify";

export interface ConfigSocio {
  codigo: string;
  comision_pct: number | null;
  meses: number | null;
  /** "mensual" (el % de cada abono, los meses acordados) o "entrada" (el % del primer abono cobrado, una sola vez). */
  modo?: "mensual" | "entrada";
}

export type Vigente = { comision_pct: number; meses: number; propia: boolean; modo: "mensual" | "entrada" };

export const CODIGO_OK = /^[a-z0-9][a-z0-9-]{2,29}$/;

export const ESTADO_LEAD: Record<string, string> = {
  no_califica: "No califica",
  calificado: "Calificado",
  reunion_agendada: "Reunión",
  propuesta: "Propuesta",
  ganado: "Ganado",
  perdido: "Perdido",
};

/** La configuración válida de un perfil (o null si no es socio). */
export function configDe(p: Record<string, unknown> | undefined | null): ConfigSocio | null {
  const s = (p?.socio ?? null) as Partial<ConfigSocio> | null;
  if (!s || typeof s.codigo !== "string" || !CODIGO_OK.test(s.codigo)) return null;
  const pct = Number(s.comision_pct);
  const meses = Math.round(Number(s.meses));
  return {
    codigo: s.codigo,
    comision_pct: s.comision_pct != null && pct > 0 && pct <= 100 ? pct : null,
    meses: s.meses != null && meses >= 1 && meses <= 120 ? meses : null,
    modo: s.modo === "entrada" ? "entrada" : "mensual",
  };
}

export const esSocio = (p: Record<string, unknown> | undefined | null) =>
  !!p && p.activo !== false && (p.role === "socio" || (Array.isArray(p.roles_extra) && p.roles_extra.includes("socio")));

/** Comisión estándar para todos los vendedores (la carga el admin en CRM → Vendedores). Null si no está cargada. */
export async function comisionEstandar(): Promise<{ comision_pct: number; meses: number } | null> {
  const d = (await adminDb().collection("web_config").doc("general").get()).data() ?? {};
  const s = (d.socio_comision ?? null) as { comision_pct?: number; meses?: number } | null;
  const pct = Number(s?.comision_pct);
  const meses = Math.round(Number(s?.meses));
  return pct > 0 && pct <= 100 && meses >= 1 && meses <= 120 ? { comision_pct: pct, meses } : null;
}

export async function guardarEstandar(entrada: unknown) {
  const s = (entrada ?? {}) as Record<string, unknown>;
  const pct = Number(s.comision_pct);
  const meses = Math.round(Number(s.meses));
  if (!(pct > 0 && pct <= 100)) throw new HttpError(400, "La comisión es un porcentaje entre 0 y 100");
  if (!(meses >= 1 && meses <= 120)) throw new HttpError(400, "Los meses van de 1 a 120");
  await adminDb().collection("web_config").doc("general").set({ socio_comision: { comision_pct: pct, meses } }, { merge: true });
  return { ok: true };
}

/** La comisión que vale para un vendedor: la suya (si la tiene cargada) o la estándar. */
export function comisionVigente(c: ConfigSocio | null, estandar: { comision_pct: number; meses: number } | null): Vigente | null {
  if (c?.modo === "entrada") return c.comision_pct ? { comision_pct: c.comision_pct, meses: 1, propia: true, modo: "entrada" } : null;
  if (c?.comision_pct && c.meses) return { comision_pct: c.comision_pct, meses: c.meses, propia: true, modo: "mensual" };
  if (estandar) return { comision_pct: c?.comision_pct || estandar.comision_pct, meses: c?.meses || estandar.meses, propia: !!(c?.comision_pct || c?.meses), modo: "mensual" };
  return null;
}

/** Todos los socios (activos o no) con su configuración. */
export async function listarSocios(): Promise<{ uid: string; nombre: string; activo: boolean; config: ConfigSocio | null }[]> {
  const r = await getPool().query(
    "select id, data from documentos where coleccion = 'profiles' and (data->>'role' = 'socio' or data->'roles_extra' @> '[\"socio\"]'::jsonb)"
  );
  return (r.rows as { id: string; data: Record<string, unknown> }[]).map((x) => ({
    uid: x.id,
    nombre: String(x.data.nombre ?? ""),
    activo: x.data.activo !== false,
    config: configDe(x.data),
  }));
}

/** El socio activo de un código de referido (o null). */
export async function socioPorCodigo(codigo: string): Promise<{ uid: string; nombre: string } | null> {
  const c = String(codigo ?? "").trim().toLowerCase();
  if (!CODIGO_OK.test(c)) return null;
  const r = await getPool().query("select id, data from documentos where coleccion = 'profiles' and data->'socio'->>'codigo' = $1 limit 1", [c]);
  const row = r.rows[0] as { id: string; data: Record<string, unknown> } | undefined;
  if (!row || !esSocio(row.data)) return null;
  return { uid: row.id, nombre: String(row.data.nombre ?? "") };
}

/** ¿Ese código ya lo usa otro? */
export async function codigoOcupado(codigo: string, menos?: string): Promise<boolean> {
  const r = await getPool().query("select id from documentos where coleccion = 'profiles' and data->'socio'->>'codigo' = $1", [codigo]);
  return (r.rows as { id: string }[]).some((x) => x.id !== menos);
}

/** Valida y normaliza la configuración que manda el admin. */
export async function configValida(entrada: unknown, uid?: string): Promise<ConfigSocio> {
  const s = (entrada ?? {}) as Record<string, unknown>;
  const codigo = String(s.codigo ?? "").trim().toLowerCase();
  if (!CODIGO_OK.test(codigo)) throw new HttpError(400, "El código del socio va en minúsculas, sin espacios (ej: juanperez), de 3 a 30 letras o números");
  if (await codigoOcupado(codigo, uid)) throw new HttpError(409, `El código «${codigo}» ya lo usa otro socio`);
  const pct = s.comision_pct === "" || s.comision_pct == null ? null : Number(s.comision_pct);
  const meses = s.meses === "" || s.meses == null ? null : Math.round(Number(s.meses));
  if (pct != null && !(pct > 0 && pct <= 100)) throw new HttpError(400, "La comisión es un porcentaje entre 0 y 100");
  if (meses != null && !(meses >= 1 && meses <= 120)) throw new HttpError(400, "Los meses de comisión van de 1 a 120");
  // Premio de entrada: un % del primer abono, una sola vez (los meses no cuentan). Necesita su porcentaje.
  if (s.modo === "entrada") {
    if (pct == null) throw new HttpError(400, "Poné el porcentaje del premio de entrada");
    return { codigo, comision_pct: pct, meses: null, modo: "entrada" };
  }
  return { codigo, comision_pct: pct, meses, modo: "mensual" };
}

async function admins(): Promise<string[]> {
  const snap = await adminDb().collection("profiles").where("role", "==", "admin").get();
  return snap.docs.filter((d) => d.data().activo !== false).map((d) => d.id);
}

/** Aviso al socio (push, en la app y por mail) cuando uno de sus leads cambia de estado. */
export async function avisarEstadoAlSocio(lead: Record<string, unknown>, id: string, estado: string, base: string) {
  const socio = typeof lead.socio_id === "string" ? lead.socio_id : null;
  if (!socio || !ESTADO_LEAD[estado]) return;
  const negocio = String(lead.negocio ?? "Tu empresario");
  await enviarAviso(
    {
      destinatarios: [socio],
      titulo: estado === "ganado" ? `🎉 ¡${negocio} ya es cliente!` : `${negocio}: ${ESTADO_LEAD[estado]}`,
      cuerpo: estado === "ganado" ? "Se cerró. Vas a ver tu comisión cuando cobremos sus abonos." : `Tu lead pasó a «${ESTADO_LEAD[estado]}».`,
      link: "/socio",
      clave: `socio-lead:${id}:${estado}`,
    },
    base
  ).catch(() => undefined);
}

/** Aviso al admin: algo de un socio para mirar (lead repetido, socio sin comisión cargada…). */
export async function avisarAdmin(titulo: string, cuerpo: string, link: string, clave: string, base: string) {
  await enviarAviso({ destinatarios: await admins(), titulo, cuerpo, link, clave }, base).catch(() => undefined);
}

// ---- Comisiones ----

const MES_OK = /^\d{4}-\d{2}$/;
/** Mes (YYYY-MM) en Argentina de una fecha ISO. */
const mesAR = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 7);
export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface LineaComision {
  factura_id: string;
  proyecto_id: string;
  cliente: string;
  /** Mes del servicio de la boleta. */
  periodo: string;
  /** Abono neto sin IVA que cuenta (sin pauta ni reintegros). */
  base: number;
  comision: number;
}

export interface ComisionSocio {
  uid: string;
  nombre: string;
  mes: string;
  config: ConfigSocio | null;
  /** Falta el porcentaje o los meses: no se calcula. */
  sin_config: boolean;
  /** La que se aplica (la suya o la estándar). */
  vigente: Vigente | null;
  base: number;
  total: number;
  lineas: LineaComision[];
}

interface ClienteSocio {
  id: string;
  nombre: string;
  socio_id: string;
  /** Mes del alta (YYYY-MM). */
  desde: string;
}

async function clientesConSocio(): Promise<ClienteSocio[]> {
  const r = await getPool().query("select id, data from documentos where coleccion = 'projects' and coalesce(data->>'socio_id', '') <> ''");
  return (r.rows as { id: string; data: Record<string, unknown> }[]).map((x) => ({
    id: x.id,
    nombre: String(x.data.nombre ?? ""),
    socio_id: String(x.data.socio_id),
    desde: String(x.data.socio_alta ?? x.data.alta ?? x.data.created_at ?? "").slice(0, 7),
  }));
}

/**
 * Lo que le corresponde a cada socio por lo cobrado en `mes` (boletas cobradas ese mes, en Argentina). Cada abono
 * (ítem REDES) se atribuye al cliente: el de la boleta o, si la boleta agrupa varias empresas, el de la empresa de ese
 * ítem («… · Nombre»). Cuenta si el período de la boleta está dentro de los meses de comisión desde el alta.
 */
export async function comisionesDelMes(mes: string, soloUid?: string): Promise<ComisionSocio[]> {
  if (!MES_OK.test(mes)) throw new HttpError(400, "Mes inválido");
  const [socios, clientes, estandar] = await Promise.all([listarSocios(), clientesConSocio(), comisionEstandar()]);
  const lista = socios.filter((s) => !soloUid || s.uid === soloUid);
  const porId = new Map(clientes.map((c) => [c.id, c]));
  // Premio de entrada: cuál fue el primer abono cobrado de cada cliente (el período más viejo con boleta cobrada).
  const primeros = new Map<string, string>();
  if (lista.some((s) => s.config?.modo === "entrada") && clientes.length) {
    const r0 = await getPool().query(
      `select data->>'proyecto_id' as pid, min(coalesce(nullif(data->>'periodo', ''), data->>'mes')) as primero
         from documentos where coleccion = 'facturas' and data->>'estado' = 'cobrada' and data->>'proyecto_id' = any($1) and coalesce(data->>'demo_ejemplo', '') <> 'true'
        group by 1`,
      [clientes.map((c) => c.id)]
    );
    for (const x of r0.rows as { pid: string; primero: string }[]) primeros.set(x.pid, x.primero);
  }
  const porNombre = new Map(clientes.map((c) => [c.nombre.trim().toLowerCase(), c]));
  // Boletas cobradas en el mes (un día de margen por la zona horaria; se filtra exacto abajo).
  const [y, m] = mes.split("-").map(Number);
  const desde = new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString().slice(0, 10);
  const hasta = `${sumarMeses(mes, 1)}-02`;
  const r = await getPool().query(
    "select id, data from documentos where coleccion = 'facturas' and data->>'estado' = 'cobrada' and data->>'cobrado_at' >= $1 and data->>'cobrado_at' < $2",
    [desde, hasta]
  );
  const out = new Map<string, ComisionSocio>(
    lista.map((s) => [
      s.uid,
      (() => {
        const vigente = comisionVigente(s.config, estandar);
        return { uid: s.uid, nombre: s.nombre, mes, config: s.config, vigente, sin_config: !vigente, base: 0, total: 0, lineas: [] as LineaComision[] };
      })(),
    ])
  );
  for (const row of r.rows as { id: string; data: Record<string, unknown> }[]) {
    const f = row.data;
    if (f.demo_ejemplo || !f.cobrado_at || mesAR(String(f.cobrado_at)) !== mes) continue;
    const periodo = String(f.periodo || f.mes || "");
    const items = Array.isArray(f.items) ? (f.items as { id?: string; concepto?: string; servicio?: string; neto?: number }[]) : [];
    const bases = new Map<string, number>();
    for (const it of items) {
      if (it.servicio !== "REDES") continue; // pauta, reintegros y extras no cuentan
      let cliente: ClienteSocio | undefined;
      if (/^grupo\d+$/.test(String(it.id ?? ""))) {
        const nombre = String(it.concepto ?? "").split(" · ").pop()?.trim().toLowerCase() ?? "";
        cliente = porNombre.get(nombre);
      } else cliente = porId.get(String(f.proyecto_id));
      if (!cliente) continue;
      bases.set(cliente.id, (bases.get(cliente.id) ?? 0) + (Number(it.neto) || 0));
    }
    for (const [pid, base] of bases) {
      const c = porId.get(pid)!;
      const s = out.get(c.socio_id);
      if (!s || !(base > 0) || !c.desde) continue;
      const meses = s.vigente?.meses ?? 0;
      const dentro =
        s.vigente?.modo === "entrada"
          ? periodo >= c.desde && periodo === (primeros.get(pid) ?? periodo)
          : periodo >= c.desde && (!meses || periodo <= sumarMeses(c.desde, meses - 1));
      if (!dentro) continue;
      const comision = s.vigente ? Math.round((base * s.vigente.comision_pct) / 100) : 0;
      s.lineas.push({ factura_id: row.id, proyecto_id: pid, cliente: c.nombre, periodo, base: Math.round(base), comision });
      s.base += Math.round(base);
      s.total += comision;
    }
  }
  return [...out.values()];
}

/** Resumen para el admin: leads traídos, clientes ganados, lo facturado y la comisión del mes de cada socio. */
export async function resumenSocios(mes: string) {
  const [comisiones, leads, clientes] = await Promise.all([
    comisionesDelMes(mes),
    getPool().query("select data->>'socio_id' as socio, data->>'estado' as estado from documentos where coleccion = 'leads_web' and coalesce(data->>'socio_id', '') <> ''"),
    clientesConSocio(),
  ]);
  const socios = await listarSocios();
  return comisiones.map((c) => {
    const suyos = (leads.rows as { socio: string; estado: string }[]).filter((l) => l.socio === c.uid);
    const s = socios.find((x) => x.uid === c.uid);
    return {
      ...c,
      activo: s?.activo ?? true,
      leads: suyos.length,
      ganados: suyos.filter((l) => l.estado === "ganado").length,
      clientes: clientes.filter((x) => x.socio_id === c.uid).length,
    };
  });
}
