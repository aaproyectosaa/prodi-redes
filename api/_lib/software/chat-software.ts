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
