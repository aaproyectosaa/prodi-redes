// Permiso corto para ver un archivo de Drive en <video> (que no puede mandar el header de la sesión).
// Formato: base64url("m1.<fileId>.<vence_epoch>").<hmac>  · vale 1 hora y solo para ese archivo.
// Así la sesión de 30 días nunca viaja en la URL (logs, historial, Referer).

import crypto from "crypto";
import { HttpError } from "./auth";
import { getPool } from "./db";
import type { Caller } from "./http";

const TTL_SEG = 60 * 60;
/** Ven los archivos de todos los clientes (igual que assertProjectAccess). */
const GLOBALES = ["admin", "diseno", "administracion"];
const ASIGNABLES = ["productor", "editor", "pauta", "cliente"];

export const fileIdValido = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(id);

/** Clave propia (derivada de AUTH_SECRET): no se reutiliza la de la sesión ni la de cifrado. */
function clave(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("Falta AUTH_SECRET (mínimo 32 caracteres) en las variables de entorno.");
  return crypto.createHmac("sha256", s).update("prodi:media-token:v1").digest();
}

const firmar = (data: string) => crypto.createHmac("sha256", clave()).update(`media:${data}`).digest("base64url");

export function crearTokenMedia(fileId: string): { token: string; vence: number } {
  const vence = Math.floor(Date.now() / 1000) + TTL_SEG;
  const data = Buffer.from(`m1.${fileId}.${vence}`).toString("base64url");
  return { token: `${data}.${firmar(data)}`, vence };
}

/** Tira 403 si el token no es de este archivo o venció. */
export function validarTokenMedia(token: unknown, fileId: string): void {
  const [data, sig] = String(token ?? "").split(".");
  if (!data || !sig) throw new HttpError(403, "Link inválido");
  const a = Buffer.from(firmar(data));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, "Link inválido");
  const [v, id, vence] = Buffer.from(data, "base64url").toString().split(".");
  if (v !== "m1" || id !== fileId) throw new HttpError(403, "Link inválido");
  if (!(Number(vence) * 1000 > Date.now())) throw new HttpError(403, "El link del archivo venció. Volvé a abrirlo.");
}

/**
 * ¿Se mandó en un chat donde está esta persona? Los mensajes con `archivo` solo los escribe el servidor
 * (/api/drive/chat-archivo), así que nadie puede "colgar" en un chat un archivo ajeno para verlo.
 */
async function enChatDe(uid: string, fileId: string): Promise<boolean> {
  const r = await getPool().query(
    `select distinct split_part(coleccion, '/', 2) as chat
       from documentos
      where coleccion like 'chats/%/mensajes' and data @> $1::jsonb
      limit 20`,
    [JSON.stringify({ archivo: { drive_file_id: fileId } })]
  );
  const chats = (r.rows as { chat: string }[]).map((x) => x.chat);
  if (!chats.length) return false;
  const m = await getPool().query(
    "select 1 from documentos where coleccion = 'chats' and id = any($1::text[]) and data->'miembros' @> jsonb_build_array($2::text) limit 1",
    [chats, uid]
  );
  return m.rows.length > 0;
}

/**
 * ¿Puede ver este archivo? Tiene que estar en un video, pieza, reunión, en un chat del que es miembro o en la marca de un cliente
 * al que tenga acceso. Una sola consulta (usa el índice GIN de `data`).
 */
export async function puedeVerArchivo(caller: Caller, fileId: string): Promise<boolean> {
  if (GLOBALES.includes(caller.role)) return true;
  // Contacto (solo chat): únicamente los archivos mandados en sus chats.
  if (caller.role === "contacto") return enChatDe(caller.uid, fileId);
  if (!ASIGNABLES.includes(caller.role)) return false;
  if (await enChatDe(caller.uid, fileId)) return true;
  const ref = [{ drive_file_id: fileId }];
  const r = await getPool().query(
    `select coleccion, id, data->>'proyecto_id' as pid, data->'participantes' as participantes
       from documentos
      where (coleccion in ('videos', 'piezas_ia', 'reuniones')
             and (data @> $1::jsonb or data @> $2::jsonb or data @> $3::jsonb))
         or (coleccion = 'projects' and (data @> $4::jsonb or data @> $5::jsonb))
      limit 50`,
    [
      JSON.stringify({ attachments_crudo: ref }),
      JSON.stringify({ attachments_finalizado: ref }),
      JSON.stringify({ versiones: ref }),
      JSON.stringify({ marca_archivos: { logo: ref[0] } }),
      JSON.stringify({ marca_archivos: { referencias: ref } }),
    ]
  );
  const proyectos = new Set<string>();
  for (const row of r.rows as { coleccion: string; id: string; pid: string | null; participantes: unknown }[]) {
    if (row.coleccion === "reuniones" && Array.isArray(row.participantes) && row.participantes.includes(caller.uid)) return true;
    const pid = row.coleccion === "projects" ? row.id : row.pid;
    if (pid) proyectos.add(pid);
  }
  if (!proyectos.size) return false;
  const p = await getPool().query(
    "select data->'team_roles' as team from documentos where coleccion = 'projects' and id = any($1::text[])",
    [[...proyectos]]
  );
  return (p.rows as { team: unknown }[]).some(({ team }) => {
    if (!team || typeof team !== "object" || Array.isArray(team)) return false;
    const t = team as Record<string, unknown>;
    // El cliente, solo como cliente; el equipo, en cualquier rol del proyecto (como assertProjectAccess).
    const listas = caller.role === "cliente" ? [t.cliente] : Object.values(t);
    return listas.some((ids) => Array.isArray(ids) && ids.includes(caller.uid));
  });
}
