// CRM (beta): lo que más preguntan y objetan los contactos de un cliente, convertido en ideas de video.
// La IA lee lo que escribió cada contacto en los últimos 60 días (lo que pidió, lo que respondió, las notas y por qué
// no compró), junta lo que se repite y para cada tema propone un video que lo responda. Queda guardado en
// crm_ideas/{cliente} (solo lo escribe el servidor) y entra solo en el plan del mes (ver textoCrmParaPlan).

import { adminDb } from "./db";
import { assertProjectAccess, HttpError, type Caller } from "./http";
import { generarJSONBarato } from "./ia";
import { controlarTopeIA } from "./tope-ia";

export interface TemaCrm {
  tema: string;
  tipo: "pregunta" | "objecion" | "pedido";
  veces: number;
  ejemplos: string[];
  idea: { titulo: string; idea: string };
}

const DIAS = 60;
/** Se vuelve a leer como mucho una vez cada 6 horas (cada lectura gasta IA). */
const CADA_MS = 6 * 3_600_000;

export async function ideasDeLosChats(caller: Caller, proyectoId: string, rehacer: boolean) {
  if (!/^[\w-]{1,60}$/.test(proyectoId)) throw new HttpError(400, "Cliente inválido");
  await assertProjectAccess(caller, proyectoId);
  const db = adminDb();
  const p = (await db.collection("projects").doc(proyectoId).get()).data();
  if (!p?.crm_activo) throw new HttpError(403, "El CRM no está activo para este cliente");
  const ref = db.collection("crm_ideas").doc(proyectoId);
  const previo = (await ref.get()).data();
  const edad = previo?.at ? Date.now() - Date.parse(String(previo.at)) : Infinity;
  if (previo && (!rehacer || edad < CADA_MS)) return previo;

  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();
  const snap = await db.collection("crm_contactos").where("proyecto_id", "==", proyectoId).get();
  const lineas: string[] = [];
  for (const d of snap.docs) {
    const c = d.data();
    if (String(c.creado_at ?? "") < desde && String(c.actualizado_at ?? "") < desde) continue;
    const de = String(c.nombre ?? "Contacto").split(" ")[0];
    if (c.interes) lineas.push(`${de} (al escribir): ${String(c.interes).slice(0, 300)}`);
    for (const h of Array.isArray(c.historial) ? c.historial : []) {
      if (String(h?.at ?? "") < desde || !h?.texto) continue;
      if (h.tipo === "suyo") lineas.push(`${de} respondió: ${String(h.texto).slice(0, 300)}`);
      else if (h.tipo === "nota" || h.tipo === "llamada" || h.tipo === "visita") lineas.push(`Nota del vendedor sobre ${de}: ${String(h.texto).slice(0, 300)}`);
    }
    if (c.notas) lineas.push(`Nota del vendedor sobre ${de}: ${String(c.notas).slice(0, 300)}`);
    if (c.etapa === "perdido" && c.perdido_motivo) lineas.push(`${de} no compró porque: ${String(c.perdido_motivo).slice(0, 200)}`);
  }
  const at = new Date().toISOString();
  if (lineas.length < 3) {
    const vacio = { at, temas: [] as TemaCrm[], leidos: lineas.length, poco: true };
    await ref.set(vacio);
    return vacio;
  }

  await controlarTopeIA(caller, "crm-ideas");
  const prompt = `Sos el director creativo de Prodi, una agencia argentina que filma Reels para comercios y los pauta en Meta para conseguir mensajes y ventas.
Abajo están las consultas y comentarios de los clientes de "${String(p.nombre ?? "este negocio")}"${p.marca?.rubro ? ` (rubro: ${p.marca.rubro})` : ""} de los últimos ${DIAS} días, y las notas de sus vendedores.

Encontrá lo que SE REPITE (al menos 2 personas): preguntas (envíos, horarios, formas de pago, si tienen tal producto), objeciones (es caro, queda lejos, desconfianza) o pedidos (un producto, una promo).
Para cada tema:
- tema: en pocas palabras (ej. "¿Hacen delivery?", "Les parece caro").
- tipo: "pregunta", "objecion" o "pedido".
- veces: cuántas personas distintas lo mencionaron (contá de verdad, no inventes).
- ejemplos: 1 o 2 frases cortas tal como las escribieron.
- idea: un Reel de 20 a 40 segundos que responda eso antes de que pregunten. titulo (máximo 7 palabras) e idea (2 oraciones: qué se ve y qué se dice, con un gancho en los primeros 3 segundos).
Ordená de más a menos repetido. Máximo 5 temas. Si nada se repite, devolvé la lista vacía. No inventes precios ni promociones. Español rioplatense con voseo.

Consultas:
${lineas.join("\n").slice(-14000)}`;
  const r = await generarJSONBarato<{ temas?: TemaCrm[] }>(prompt, {
    type: "OBJECT",
    properties: {
      temas: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            tema: { type: "STRING" },
            tipo: { type: "STRING", enum: ["pregunta", "objecion", "pedido"] },
            veces: { type: "INTEGER" },
            ejemplos: { type: "ARRAY", items: { type: "STRING" } },
            idea: { type: "OBJECT", properties: { titulo: { type: "STRING" }, idea: { type: "STRING" } }, required: ["titulo", "idea"] },
          },
          required: ["tema", "tipo", "veces", "idea"],
        },
      },
    },
    required: ["temas"],
  });
  const temas = (r.temas ?? [])
    .filter((t) => t?.tema && t?.idea?.titulo)
    .slice(0, 5)
    .map((t) => ({
      tema: String(t.tema).slice(0, 120),
      tipo: (["pregunta", "objecion", "pedido"].includes(t.tipo) ? t.tipo : "pregunta") as TemaCrm["tipo"],
      veces: Math.max(1, Math.round(Number(t.veces) || 1)),
      ejemplos: (t.ejemplos ?? []).slice(0, 2).map((e) => String(e).slice(0, 160)),
      idea: { titulo: String(t.idea.titulo).slice(0, 80), idea: String(t.idea.idea ?? "").slice(0, 500) },
    }));
  const out = { at, temas, leidos: lineas.length };
  await ref.set(out);
  return out;
}

/** Para el plan del mes: lo que se repite en los chats del cliente (si tiene el CRM y ya se leyó). */
export async function textoCrmParaPlan(proyectoId: string): Promise<string> {
  const d = (await adminDb().collection("crm_ideas").doc(proyectoId).get()).data();
  const temas = (d?.temas ?? []) as TemaCrm[];
  if (!temas.length) return "";
  const tipo = { pregunta: "preguntan", objecion: "objetan", pedido: "piden" };
  return `Lo que más preguntan, objetan o piden los clientes de este negocio en sus chats (CRM, últimos ${DIAS} días). Al menos una idea tiene que responder alguno de estos temas:\n${temas
    .map((t) => `- ${t.tema} (${t.veces} personas lo ${tipo[t.tipo]})${t.ejemplos[0] ? `: "${t.ejemplos[0]}"` : ""}`)
    .join("\n")}`;
}
