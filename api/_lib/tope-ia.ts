// Tope de uso diario de la IA (Claude / Gemini) para las acciones de /api/ia: que nadie la use sin freno.
// Cada uso queda en "ia_usos" (uid, accion, at). @prodi en el chat tiene su propio tope (chat-asistente.ts).

import { adminDb } from "./db";
import { HttpError, type Caller } from "./http";

// ── Números (fáciles de cambiar) ────────────────────────────────────────────────────────────────
/** Usos por persona en las últimas 24 h, según el rol. */
const TOPE_ADMIN = 300;
const TOPE_EQUIPO = 150;
const TOPE_CLIENTE = 30;
/** Acciones caras: tope propio por persona en 24 h. */
const TOPE_MINUTA = 10;
const TOPE_PIEZAS = 20; // pieza + pieza-editar juntas
/** Links del chat: corre solo en segundo plano al mandar un mensaje, así que va aparte (no gasta el tope de la persona). */
const TOPE_LINKS_CHAT = 100;
/** Sugerir tareas en el chat de Software: también en segundo plano y aparte; tope entre todos en 24 h. */
const TOPE_SOFTWARE_TAREA = 300;
/** Acciones de segundo plano: no gastan el tope de la persona. */
const APARTE = ["links-chat", "software-tarea", "resumen-pedido"];
/** Entre todo el sistema en 24 h (el admin no lo tiene). */
const TOPE_GLOBAL = 1500;

const EQUIPO = ["productor", "editor", "pauta", "diseno", "administracion"];
const MENSAJE = "Llegaste al límite de uso de la IA por hoy. Mañana sigue.";

/** Cuenta el uso y corta con 429 si se pasa de algún tope. Va antes de llamar al modelo. */
export async function controlarTopeIA(caller: Caller, accion: string): Promise<void> {
  const db = adminDb();
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const esAdmin = caller.role === "admin";

  const mios = (await db.collection("ia_usos").where("uid", "==", caller.uid).where("at", ">", desde).get()).docs.map((d) => String(d.data().accion));
  if (accion === "links-chat") {
    if (mios.filter((a) => a === "links-chat").length >= TOPE_LINKS_CHAT) throw new HttpError(429, MENSAJE);
  } else if (accion === "software-tarea") {
    const deTodos = await db.collection("ia_usos").where("accion", "==", "software-tarea").where("at", ">", desde).get();
    if (deTodos.size >= TOPE_SOFTWARE_TAREA) throw new HttpError(429, MENSAJE);
  } else {
    const propios = mios.filter((a) => !APARTE.includes(a)).length;
    const tope = esAdmin ? TOPE_ADMIN : caller.roles.some((r) => EQUIPO.includes(r)) ? TOPE_EQUIPO : TOPE_CLIENTE;
    if (propios >= tope) throw new HttpError(429, MENSAJE);
  }
  if (accion === "minuta" && mios.filter((a) => a === "minuta").length >= TOPE_MINUTA) throw new HttpError(429, MENSAJE);
  if ((accion === "pieza" || accion === "pieza-editar") && mios.filter((a) => a === "pieza" || a === "pieza-editar").length >= TOPE_PIEZAS)
    throw new HttpError(429, MENSAJE);
  if (!esAdmin && accion !== "software-tarea") {
    const todos = await db.collection("ia_usos").where("at", ">", desde).get();
    if (todos.size >= TOPE_GLOBAL) throw new HttpError(429, MENSAJE);
  }

  await db.collection("ia_usos").add({ uid: caller.uid, accion, at: new Date().toISOString() });
  // De vez en cuando se borra lo de hace más de 2 días (no sirve para ningún tope).
  if (Math.random() < 0.02) {
    const viejo = new Date(Date.now() - 48 * 3600_000).toISOString();
    const viejos = await db.collection("ia_usos").where("at", "<", viejo).limit(400).get();
    if (!viejos.empty) {
      const lote = db.batch();
      viejos.docs.forEach((d) => lote.delete(d.ref));
      await lote.commit().catch(() => undefined);
    }
  }
}
