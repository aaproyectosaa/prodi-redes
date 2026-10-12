// Chat de Prodi Software: qué conversaciones son de Software (el grupo "Equipo Software" y los privados entre gente
// de Software) y los clientes de Software (para las tareas). Prodi Redes no usa nada de esto.

import { adminDb, getPool, type Data } from "../db";

/** Roles de Software (principal o adicional). */
export const ROLES_SOFTWARE = ["admin", "administracion", "programador"];

const rolesDe = (p: Data | undefined): string[] => [
  String(p?.role ?? ""),
  ...(Array.isArray(p?.roles_extra) ? (p!.roles_extra as unknown[]).map(String) : []),
];

/** ¿La persona es de Software? (admin, administración o programación, como rol principal o adicional). */
export const esDeSoftware = (p: Data | undefined) => !!p && p.activo !== false && rolesDe(p).some((r) => ROLES_SOFTWARE.includes(r));

/** ¿Es una conversación de Software? El grupo "Equipo Software" o un privado entre dos personas de Software. */
export async function esChatSoftware(chat: Data | undefined): Promise<boolean> {
  if (!chat) return false;
  if (chat.tipo === "software") return true;
  if (chat.tipo !== "directo") return false;
  const miembros: string[] = Array.isArray(chat.miembros) ? (chat.miembros as unknown[]).map(String) : [];
  if (miembros.length !== 2) return false;
  const perfiles = await Promise.all(miembros.map((u) => adminDb().collection("profiles").doc(u).get()));
  return perfiles.every((s) => esDeSoftware(s.data()));
}

export interface ClienteSoftware {
  id: string;
  nombre: string;
  tipo: "app" | "mantenimiento";
}

/** Clientes activos de Software: los de las apps con Mercado Pago y los de mantenimiento (máximo 200 en total). */
export async function clientesSoftware(): Promise<ClienteSoftware[]> {
  const pool = getPool();
  const [apps, mant] = await Promise.all([
    pool.query("select id::text as id, name from hub_clients where active order by name limit 200").catch(() => ({ rows: [] })),
    pool.query("select id::text as id, name from hub_maintenance_clients where active order by name limit 200").catch(() => ({ rows: [] })),
  ]);
  return [
    ...(apps.rows as { id: string; name: string }[]).map((x) => ({ id: x.id, nombre: x.name, tipo: "app" as const })),
    ...(mant.rows as { id: string; name: string }[]).map((x) => ({ id: x.id, nombre: x.name, tipo: "mantenimiento" as const })),
  ].slice(0, 200);
}

/** El cliente de Software con ese id y tipo (o null si no existe o no está activo). */
export async function clienteSoftware(id: unknown, tipo: unknown): Promise<ClienteSoftware | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (tipo !== "app" && tipo !== "mantenimiento") return null;
  const tabla = tipo === "app" ? "hub_clients" : "hub_maintenance_clients";
  const r = await getPool()
    .query(`select id::text as id, name from ${tabla} where id = $1`, [id])
    .catch(() => ({ rows: [] }));
  const f = r.rows[0] as { id: string; name: string } | undefined;
  return f ? { id: f.id, nombre: f.name, tipo } : null;
}

const SIN_PESO = new Set(["sa", "srl", "sas", "de", "del", "la", "el", "los", "las", "y", "e", "app"]);
/** "Dulce Capricho S.R.L." → ["dulce", "capricho"]: sin tildes, mayúsculas, signos ni palabras de relleno. */
function palabras(nombre: string): string[] {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((p) => p && !SIN_PESO.has(p));
}

/**
 * Clientes de Redes (projects) que también son clientes de Software: mismo nombre, o todas las palabras del
 * más corto están en el otro ("Dulce Capricho" ↔ "Dulce Capricho Pastelería"). Para marcar sus chats.
 */
export async function proyectosQueSonDeSoftware(): Promise<string[]> {
  const sw = (await clientesSoftware()).map((c) => palabras(c.nombre)).filter((p) => p.join("").length >= 4);
  if (!sw.length) return [];
  const r = await getPool().query("select id, data->>'nombre' as nombre from documentos where coleccion = 'projects'");
  const out: string[] = [];
  for (const row of r.rows as { id: string; nombre: string | null }[]) {
    const p = palabras(row.nombre ?? "");
    if (p.join("").length < 4) continue;
    const coincide = sw.some((s) => {
      const [corto, largo] = s.length <= p.length ? [s, p] : [p, s];
      // Una sola palabra corta ("test") no alcanza: con una palabra, que tenga 5 letras o más.
      if (corto.length === 1 && corto[0].length < 5) return false;
      return corto.every((x) => largo.includes(x));
    });
    if (coincide) out.push(row.id);
  }
  return out;
}
