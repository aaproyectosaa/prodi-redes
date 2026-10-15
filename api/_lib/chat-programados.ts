// Mensajes programados del chat: se guardan en "programados" y los manda el servidor cuando llega la hora.
// Se revisan cada vez que alguien usa la app (api/db cambios, a lo sumo una vez por minuto): sale a la hora,
// o apenas alguien entra si justo nadie la estaba usando.

import { adminDb, getPool } from "./db";
import { avisarMensaje, publicarEnChat } from "./chat-server";

export async function enviarProgramados(baseUrl: string): Promise<number> {
  const ahora = new Date().toISOString();
  const r = await getPool().query(
    "select id, data from documentos where coleccion = 'programados' and data->>'enviar_at' <= $1 order by data->>'enviar_at' limit 20",
    [ahora]
  );
  let enviados = 0;
  const db = adminDb();
  for (const fila of r.rows as { id: string; data: Record<string, unknown> }[]) {
    const p = fila.data;
    // Se borra primero (en una transacción): si dos instancias lo agarran a la vez, solo lo manda la que lo borró.
    const ref = db.collection("programados").doc(fila.id);
    const mio = await db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) return false;
      tx.delete(ref);
      return true;
    });
    if (!mio) continue;
    const chatId = String(p.chat_id ?? "");
    const by = String(p.by ?? "");
    const chat = (await db.collection("chats").doc(chatId).get()).data();
    // Si ya no está en el chat (lo sacaron, se fue), no se manda.
    if (!chat || !Array.isArray(chat.miembros) || !chat.miembros.includes(by)) continue;
    const texto = String(p.texto ?? "").slice(0, 4000);
    if (!texto.trim()) continue;
    const at = new Date().toISOString();
    await publicarEnChat(chatId, { texto, by, by_nombre: String(p.by_nombre ?? ""), at, tipo: "texto", link: null, reunion_id: null, programado: true });
    await avisarMensaje(chatId, chat, by, String(p.by_nombre ?? ""), texto, baseUrl).catch(() => undefined);
    enviados++;
  }
  return enviados;
}
