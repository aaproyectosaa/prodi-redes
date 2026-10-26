// Quién aprueba internamente los videos y las piezas antes de que le lleguen al cliente.
//
// La revisión interna es de producción, nunca del super admin (Lucas no supervisa): aunque figure en Producción de un
// cliente (como comodín), los avisos de "para aprobar", los recordatorios y lo atrasado van a la productora del cliente
// y, si no hay otra, a quien tiene marcado "Supervisa la revisión interna" en Equipo (profiles.supervisa_revision).

import { adminDb } from "./db";

/** Claves de los avisos de revisión interna (videos, piezas y "pedir revisión" en capacitación). */
export const esAvisoDeRevision = (clave: string) =>
  clave.startsWith("revision_interna:") || clave.startsWith("pieza_revision:") || clave.startsWith("revision_supervisor:");

async function perfilesDe(campo: "role" | "supervisa_revision", valor: string | boolean): Promise<string[]> {
  const snap = await adminDb().collection("profiles").where(campo, "==", valor).get();
  return snap.docs.filter((d) => d.data().activo !== false).map((d) => d.id);
}

/** Quienes supervisan la revisión interna (marcados en Equipo). */
export const supervisoresRevision = () => perfilesDe("supervisa_revision", true);

/**
 * A quién le llega una revisión interna: los que se pidieron, sin los admins. Si no queda nadie (por ejemplo, el único
 * de Producción del cliente era el admin), a quien supervisa la revisión.
 */
export async function revisoresSinAdmin(pedidos: string[]): Promise<string[]> {
  const admins = new Set(await perfilesDe("role", "admin"));
  const sin = [...new Set(pedidos)].filter((id) => !admins.has(id));
  if (sin.length) return sin;
  return (await supervisoresRevision()).filter((id) => !admins.has(id));
}
