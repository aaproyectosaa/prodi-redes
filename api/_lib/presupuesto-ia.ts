/* eslint-disable @typescript-eslint/no-explicit-any */
// Charla con la IA para armar la propuesta comercial (Presupuestos). Lucas le cuenta (escribiendo, dictando o en
// llamada) lo que negoció con el cliente y le pasa capturas, PDF o el chat de WhatsApp; la IA pregunta lo que falta y
// va armando la propuesta con el formato de Prodi (api/_lib/propuesta.ts). Los PRECIOS los pone Lucas: la IA deja
// el valor vacío salvo que él lo haya dicho (y acá se borra cualquier número que no salga de lo que dijo).

import { HttpError } from "./http";
import { generarJSON, type Adjunto } from "./ia";
import { limpiarPropuesta, type Propuesta } from "./propuesta";

export interface PedidoPropuestaIA {
  mensajes?: { rol?: string; texto?: string }[];
  propuesta?: unknown;
  empresa?: string;
  contacto?: { nombre?: string | null; telefono?: string | null };
  /** Texto de un chat de WhatsApp exportado (con los audios ya transcriptos). */
  chat?: string;
  adjuntos?: { data?: string; mime?: string }[];
  /** Viene de la llamada: respuesta corta para decir en voz alta. */
  voz?: boolean;
}

const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

/** Números que aparecen en un texto, sin ceros al final ("$220.000" y "220 mil" → "22"). */
const numeros = (s: string) =>
  new Set(
    (s.replace(/(\d)[.,](?=\d{3}\b)/g, "$1").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/[.,]/g, "").replace(/0+$/, "") || "0")
  );

/** Saca los precios que la IA puso sin que nadie los dijera. */
function sinPreciosInventados(nueva: Propuesta, anterior: Propuesta, dicho: string): Propuesta {
  const permitidos = numeros(dicho);
  const antes = new Map<string, string>();
  for (const s of anterior.secciones) for (const f of s.filas ?? []) antes.set(f.id, f.valor);
  const ok = (valor: string, previo?: string) => {
    if (!valor || valor === previo) return valor;
    const nums = [...numeros(valor)];
    return nums.length && nums.every((n) => permitidos.has(n)) ? valor : "";
  };
  return {
    ...nueva,
    secciones: nueva.secciones.map((s) =>
      s.tipo !== "inversion"
        ? s
        : (() => {
            const filas = (s.filas ?? []).map((f) => ({ ...f, valor: ok(f.valor, antes.get(f.id)) }));
            // El total puede ser la suma de los precios que dio Lucas.
            const montos = filas.map((f) => (/^\s*(US)?\$\s*[\d.]+\s*(\/\s*mes)?\s*$/i.test(f.valor) ? Number(f.valor.replace(/\D/g, "")) : NaN));
            if (montos.length && montos.every((n) => n > 0)) numeros(String(montos.reduce((x, y) => x + y, 0))).forEach((n) => permitidos.add(n));
            return { ...s, filas, total: s.total ? { ...s.total, valor: ok(s.total.valor, anterior.secciones.find((x) => x.id === s.id)?.total?.valor) } : null };
          })()
    ),
  };
}

const EJEMPLO = `Ejemplo real de una propuesta de Prodi (para copiar el tono y la estructura, NO los datos):
- etiqueta: "Propuesta resumida · Contenido, pauta y plataformas"; titulo: "Alfonsina · Integrar · Fundación"
- intro: "Un mismo equipo para los tres comercios: **4 videos profesionales por mes en cada uno, campañas en Meta Ads en Alfonsina y la Fundación, y una plataforma a medida donde se concreta la venta o la consulta**, desarrollada desde cero por Prodi sin costo de desarrollo. Prodi produce, publica y optimiza; el cliente responde los mensajes y paga la pauta directamente a Meta."
- 01 "Qué se hace en cada comercio" (detalle): tarjeta "Alfonsina · restaurante del Gran Hotel", resumen "4 videos por mes con campaña en Meta por cada uno. Plataforma: carta virtual con pedidos y sistema de administración.", viñetas "Contenido: platos, promociones, menú del día, eventos… Las campañas llevan a la carta o a WhatsApp.", "Carta virtual: el cliente ve los platos con foto y precio, arma el pedido desde el celular y lo confirma."
- 02 "Inversión · contenido y pauta" (inversion, columna MENSUAL): filas "Alfonsina" / "4 videos por mes + una campaña en Meta por cada video" / "$220.000"…; total "TOTAL CONTENIDO Y PAUTA · mensual" / "Tres comercios · 12 videos y 8 campañas por mes · + IVA con factura A · la pauta se paga directo a Meta" / "$660.000"
- 03 "Inversión · plataformas" (inversion, columna RETRIBUCIÓN): filas con "4% por venta" o "$100.000 / mes"; nota "**Qué significa el 4%.** Es lo único que Prodi cobra por la plataforma…"
- 04 "Condiciones esenciales": Pago, Alcance, Desarrollo, Baja y actualización (título corto + texto concreto).`;

export async function propuestaIA(b: PedidoPropuestaIA) {
  const mensajes = (Array.isArray(b.mensajes) ? b.mensajes : [])
    .map((m) => ({ rol: m?.rol === "ia" ? "ia" : "yo", texto: t(m?.texto, 6000) }))
    .filter((m) => m.texto)
    .slice(-30);
  const chat = String(b.chat ?? "").slice(-40000);
  const adjuntos: Adjunto[] = (Array.isArray(b.adjuntos) ? b.adjuntos : [])
    .slice(0, 8)
    .filter((a) => typeof a?.data === "string" && MIMES.has(String(a?.mime)))
    .map((a) => ({ data: Buffer.from(String(a.data), "base64"), mime: a.mime as Adjunto["mime"] }))
    .filter((a) => a.data.length > 0 && a.data.length < 4 * 1024 * 1024);
  if (!mensajes.some((m) => m.rol === "yo") && !chat && !adjuntos.length) throw new HttpError(400, "Contale a la IA qué negociaste con el cliente");
  const actual = limpiarPropuesta(b.propuesta);

  const prompt = `Sos el asistente comercial de Prodi (agencia de Reconquista, Santa Fe): hace videos verticales profesionales para negocios, los publica, los pauta en Meta Ads y también desarrolla plataformas a medida (cartas virtuales, tiendas, landings, sistemas de administración). Ayudás a Lucas, el dueño, a armar la PROPUESTA COMERCIAL que le manda al cliente, charlando con él.

Cómo trabajás:
- Lucas te cuenta lo que negoció (a veces con capturas, PDF o el chat de WhatsApp con el cliente). Vos armás o corregís la propuesta y le contestás en "respuesta".
- Las negociaciones suelen tener varias partes u opciones (ej.: "armado de una campaña" por un lado y "administración de las redes" por otro). Cada parte va en su tarjeta del "Qué hacemos" y en su propia sección de inversión (ej. "Inversión · campaña" y "Inversión · administración de redes"), así el cliente puede elegir una, la otra o las dos. Si no se sabe la cantidad exacta (ej. cuántos videos), proponé una cantidad razonable según lo que pidió y decíselo a Lucas para que la confirme.
- PRECIOS: NUNCA pongas un precio, monto, porcentaje ni total que Lucas no haya dicho. Dejá "valor" vacío ("") y en "respuesta" pedile que los ponga (puede decírtelos o escribirlos en la vista previa). Si Lucas te dicta un precio, ponelo tal cual con formato "$220.000", "$100.000 / mes", "4% por venta" o "US$ 500". Si hay total destacado y Lucas dio todos los precios, podés sumarlos.
- La propuesta actual es la verdad: Lucas la edita a mano también. Mantené todo lo que ya está (incluidos los ids y los precios) y cambiá solo lo que haga falta. Devolvé SIEMPRE la propuesta completa.
- Estilo: concreto, profesional, sin frases vacías ni exageraciones. Español rioplatense neutro, de "usted" implícito (sin voseo marcado) en la propuesta. Viñetas que empiezan con el tema y dos puntos ("Contenido: …"). En la intro y las notas, lo importante va entre **así**.
- Estructura habitual: 01 Qué hacemos (tarjetas), 02… Inversión (una o más), y al final Condiciones esenciales (Pago, Alcance, Baja y actualización; agregá Desarrollo si hay plataformas). Ajustá las condiciones a lo que se ofrece.
- "titulo": nombre del cliente o de los comercios (ej. "Hornos Cian"). "etiqueta": de qué trata en pocas palabras ("Propuesta · Campaña y administración de redes").
- "respuesta" para Lucas: ${b.voz ? "MUY corta (1 o 2 frases, se dice en voz alta), sin listas ni símbolos" : "corta (2 a 4 frases): qué armaste o cambiaste y, si falta algo importante, UNA o DOS preguntas concretas (cantidades, plazos, qué incluye cada opción, precios)"}. Tuteo rioplatense con Lucas.
- "empresa" y "contacto": el nombre del negocio y de la persona con la que habla y su WhatsApp, si aparecen (vacío si no).

${EJEMPLO}

Datos actuales: empresa "${t(b.empresa, 120)}", contacto "${t(b.contacto?.nombre, 120)}", WhatsApp "${t(b.contacto?.telefono, 40)}".

Propuesta actual (JSON):
${JSON.stringify(actual).slice(0, 12000)}

${chat ? `Chat de WhatsApp exportado con el cliente:\n${chat}\n` : ""}${adjuntos.length ? `Te adjunto ${adjuntos.length} archivo(s) (capturas o PDF): leelos con atención.\n` : ""}
Charla con Lucas (lo último es lo que acaba de decir):
${mensajes.map((m) => `${m.rol === "yo" ? "Lucas" : "Vos"}: ${m.texto}`).join("\n")}`;

  const texto = { type: "STRING" };
  const r = await generarJSON<any>(
    prompt,
    {
      type: "OBJECT",
      properties: {
        respuesta: texto,
        empresa: texto,
        contacto: { type: "OBJECT", properties: { nombre: texto, telefono: texto } },
        propuesta: {
          type: "OBJECT",
          properties: {
            etiqueta: texto,
            titulo: texto,
            intro: texto,
            secciones: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: texto,
                  tipo: { type: "STRING", enum: ["detalle", "inversion", "condiciones", "texto"] },
                  titulo: texto,
                  tarjetas: { type: "ARRAY", items: { type: "OBJECT", properties: { id: texto, titulo: texto, resumen: texto, vinetas: { type: "ARRAY", items: texto } } } },
                  columna: texto,
                  filas: { type: "ARRAY", items: { type: "OBJECT", properties: { id: texto, concepto: texto, detalle: texto, valor: texto } } },
                  total: { type: "OBJECT", properties: { etiqueta: texto, detalle: texto, valor: texto } },
                  nota: texto,
                  items: { type: "ARRAY", items: { type: "OBJECT", properties: { id: texto, titulo: texto, texto } } },
                  texto,
                },
                required: ["tipo", "titulo"],
              },
            },
          },
          required: ["titulo", "intro", "secciones"],
        },
      },
      required: ["respuesta", "propuesta"],
    },
    0.5,
    adjuntos
  );

  // Lo que no toca la IA (número, lugar, fecha, contacto de Prodi) queda como estaba.
  const nueva = limpiarPropuesta({ ...actual, ...r.propuesta, codigo: actual.codigo, lugar: actual.lugar, fecha: actual.fecha, contacto: actual.contacto });
  const dicho = [...mensajes.filter((m) => m.rol === "yo").map((m) => m.texto), chat].join("\n");
  return {
    respuesta: t(r.respuesta, 1500) || "Listo, fijate la vista previa.",
    propuesta: sinPreciosInventados(nueva, actual, dicho),
    empresa: t(r.empresa, 120),
    contacto: { nombre: t(r.contacto?.nombre, 120), telefono: t(r.contacto?.telefono, 40) },
  };
}
