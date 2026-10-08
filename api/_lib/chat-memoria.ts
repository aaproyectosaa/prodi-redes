// La IA aprende de los chats de cada cliente (ia_memoria/{cliente}.chat_notas).
//
// - Solo los grupos de un cliente (chats con proyecto_id: "cliente_<id>"). Los privados y el grupo del equipo, nunca.
// - El cron diario resume los mensajes NUEVOS (cursor por chat en ia_memoria.chat_cursor) en datos cortos
//   para el marketing: tono, productos, promos, fechas, gustos, decisiones. Nada personal.
// - "@prodi acordate que …" guarda un dato al instante.
// El plan del mes, el copy y el guion lo leen (memoriaTexto / contextoComercial).

import { adminDb, type Data } from "./db";
import { generarJSON } from "./ia";
import { fechaAR } from "./fecha";
import { notasChatTexto, type MemoriaIA, type NotaChat } from "./plan-mes";

const MAX_NOTAS = 40;
const MAX_CHATS_POR_DIA = 30;
/** La primera vez se mira hasta 14 días para atrás. */
const DIAS_INICIO = 14;

export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Datos personales que no van a la memoria (mails, teléfonos, documentos, cuentas, claves, deudas, sueldos). */
const PERSONAL = /([a-z0-9._-]+@[a-z0-9-]+\.[a-z]|\+?\d[\d\s-]{8,}\d|\b(dni|cuil|cuit|cbu|cvu|contraseña|password|deuda|sueldo|salario)\b)/i;

/** Limpia un dato que viene de la IA o de la persona. null = no se guarda. */
export function limpiarHecho(v: unknown): string | null {
  const t = String(v ?? "").replace(/\s+/g, " ").trim().replace(/^[-•*]\s*/, "").slice(0, 280);
  if (t.length < 8 || PERSONAL.test(t)) return null;
  return t;
}

/** Suma notas sin repetir (si una nueva dice lo mismo o más, reemplaza a la vieja) y deja las últimas 40. */
export function mezclarNotas(actuales: NotaChat[], nuevas: NotaChat[]): NotaChat[] {
  let out = [...actuales];
  for (const n of nuevas) {
    const k = normalizar(n.texto);
    out = out.filter((x) => {
      const kx = normalizar(x.texto);
      return !(kx === k || k.includes(kx));
    });
    if (out.some((x) => normalizar(x.texto).includes(k))) continue;
    out.push(n);
  }
  return out.slice(-MAX_NOTAS);
}

/** Guarda datos del chat en la memoria del cliente (y, si viene, mueve el cursor de ese chat). */
export async function guardarNotasChat(pid: string, chatId: string, textos: string[], por: string | null, cursor?: string): Promise<number> {
  const db = adminDb();
  const ref = db.collection("ia_memoria").doc(pid);
  const hoy = fechaAR();
  const nuevas: NotaChat[] = textos
    .map(limpiarHecho)
    .filter((t): t is string => !!t)
    .map((texto) => ({ texto, fuente: "chat", at: hoy, chat_id: chatId, por }));
  return db.runTransaction(async (tx) => {
    const m = ((await tx.get(ref)).data() ?? {}) as MemoriaIA;
    const antes = m.chat_notas ?? [];
    const chat_notas = mezclarNotas(antes, nuevas);
    const patch: Data = { proyecto_id: pid, chat_notas, chat_notas_at: new Date().toISOString() };
    if (cursor) patch.chat_cursor = { ...(m.chat_cursor ?? {}), [chatId]: cursor };
    tx.set(ref, patch, { merge: true });
    return nuevas.length;
  });
}

const ESQUEMA = {
  type: "OBJECT",
  properties: { hechos: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["hechos"],
};

/** Cron diario: resume lo nuevo de cada grupo de cliente. Devuelve un resumen para el log. */
export async function aprenderDeChats(): Promise<string> {
  const db = adminDb();
  const chats = await db.collection("chats").where("tipo", "==", "cliente").get();
  const desdeInicio = new Date(Date.now() - DIAS_INICIO * 86_400_000).toISOString();
  let procesados = 0;
  let datos = 0;
  for (const c of chats.docs) {
    if (procesados >= MAX_CHATS_POR_DIA) break;
    const chat = c.data()!;
    const pid = typeof chat.proyecto_id === "string" ? chat.proyecto_id : null;
    const ultimo = String(chat.ultimo?.at ?? "");
    if (!pid || !ultimo) continue;
    const mem = ((await db.collection("ia_memoria").doc(pid).get()).data() ?? {}) as MemoriaIA;
    const cursor = mem.chat_cursor?.[c.id] ?? desdeInicio;
    if (ultimo <= cursor) continue;
    const proj = (await db.collection("projects").doc(pid).get()).data();
    if (!proj || proj.enabled === false) continue;
    procesados++;
    try {
      const snap = await db.collection(`chats/${c.id}/mensajes`).where("at", ">", cursor).orderBy("at", "asc").limit(300).get();
      const msgs = snap.docs.map((d) => d.data()!);
      if (!msgs.length) continue;
      const nuevoCursor = String(msgs[msgs.length - 1].at);
      const clientes = new Set<string>(proj.team_roles?.cliente ?? []);
      const nombres = (chat.nombres ?? {}) as Record<string, string>;
      // Solo lo que escribió la gente (sin audios, archivos, llamadas, el asistente ni los pedidos a @prodi).
      const lineas = msgs
        .filter((m) => (m.tipo === "texto" || m.tipo === "minuta") && m.by !== "prodi" && !/(^|\s)@prodi\b/i.test(String(m.texto)))
        .map((m) => {
          const quien = `${clientes.has(m.by) ? "Cliente" : "Equipo"} (${String(nombres[m.by] ?? m.by_nombre ?? "").split(" ")[0] || "?"})`;
          return `[${fechaAR(m.at).slice(5).split("-").reverse().join("/")}] ${quien}: ${String(m.texto).slice(0, 600)}`;
        });
      let total = 0;
      const texto = lineas.filter((l) => (total += l.length) < 14_000).join("\n");
      if (texto.replace(/\s/g, "").length < 40) {
        await guardarNotasChat(pid, c.id, [], null, nuevoCursor);
        continue;
      }
      const prompt = `Sos el asistente de Prodi, una agencia argentina que hace videos y pauta en redes para comercios.
Abajo hay mensajes nuevos del grupo de chat entre el equipo de Prodi y el cliente "${proj.nombre}".
Sacá solo datos útiles para hacer su marketing: tono y estilo que le gusta, productos o servicios, precios o promos que mencionan, fechas importantes (aperturas, temporadas, eventos), cosas que le gustan o no le gustan, decisiones tomadas.
Reglas:
- Máximo 6 datos. Una oración corta cada uno, en español rioplatense, sin nombres de personas del equipo.
- Nada personal ni ajeno al negocio: salud, familia, teléfonos, mails, direcciones particulares, plata que se debe, pagos a Prodi, temas internos del equipo.
- No repitas lo que ya está en "Ya sabemos" (salvo que haya cambiado: entonces escribí el dato nuevo).
- Fechas completas (ej. "el 15/11 abre la sucursal nueva").
- Si no hay nada nuevo útil, devolvé la lista vacía.

${notasChatTexto(mem.chat_notas, 40) ? `Ya sabemos:\n${notasChatTexto(mem.chat_notas, 40)}\n` : ""}
Mensajes (del más viejo al más nuevo):
${texto}`;
      const r = await generarJSON<{ hechos?: unknown[] }>(prompt, ESQUEMA, 0.2);
      datos += await guardarNotasChat(pid, c.id, (r.hechos ?? []).slice(0, 6).map(String), null, nuevoCursor);
    } catch (err) {
      console.warn("[chat-memoria]", c.id, err);
    }
  }
  return `${procesados} chats, ${datos} datos nuevos`;
}
