/* eslint-disable @typescript-eslint/no-explicit-any */
// Presupuesto armado por la IA: a partir de lo que cuenta el admin (texto o dictado), capturas, PDF o un chat de
// WhatsApp exportado, propone empresa, contacto, plan, ítems con precios, moneda, comprobante y el mensaje para el
// cliente. Usa los planes de Prodi y los presupuestos anteriores como referencia de precios. No guarda nada: lo
// devuelve para que la persona lo revise en el formulario.

import { adminDb } from "./db";
import { HttpError } from "./http";
import { generarJSON, type Adjunto } from "./ia";

export interface PedidoPresupuestoIA {
  texto?: string;
  /** Texto de un chat de WhatsApp exportado (.txt o lo de adentro del .zip). */
  chat?: string;
  adjuntos?: { data?: string; mime?: string }[];
  /** Lo que ya está cargado en el formulario (para completar o corregir). */
  actual?: unknown;
}

const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

export async function presupuestoIA(b: PedidoPresupuestoIA) {
  const texto = t(b.texto, 6000);
  const chat = String(b.chat ?? "").slice(-40000);
  const adjuntos: Adjunto[] = (Array.isArray(b.adjuntos) ? b.adjuntos : [])
    .slice(0, 8)
    .filter((a) => typeof a?.data === "string" && MIMES.has(String(a?.mime)))
    .map((a) => ({ data: Buffer.from(String(a.data), "base64"), mime: a.mime as Adjunto["mime"] }))
    .filter((a) => a.data.length > 0 && a.data.length < 4 * 1024 * 1024);
  if (!texto && !chat && !adjuntos.length) throw new HttpError(400, "Contale a la IA de qué se trata o mandale capturas o el chat");

  const db = adminDb();
  const [planesSnap, previosSnap, cfg] = await Promise.all([
    db.collection("planes_redes").get(),
    db.collection("presupuestos").get(),
    db.collection("app_settings").doc("redes").get(),
  ]);
  const planes = planesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as any)
    .filter((p) => p.activo !== false)
    .map((p) => `- id "${p.id}": ${p.nombre} · ${p.videos_mes} videos/mes${p.piezas_mes ? ` + ${p.piezas_mes} piezas` : ""} · $${Number(p.precio_mensual).toLocaleString("es-AR")} por mes${p.precio_video_extra ? ` · video extra $${p.precio_video_extra}` : ""}`)
    .join("\n");
  const previos = previosSnap.docs
    .map((d) => d.data() as any)
    .sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)))
    .slice(0, 12)
    .flatMap((p) => (p.items ?? []).map((i: any) => `- ${i.concepto}${i.detalle ? ` (${t(i.detalle, 80)})` : ""}: ${p.moneda === "USD" ? "US$" : "$"}${i.precio} ${i.periodo === "mensual" ? "por mes" : "una vez"}`))
    .slice(0, 40)
    .join("\n");
  const iva = Number(cfg.data()?.iva_pct ?? 21);

  const prompt = `Sos el asistente comercial de Prodi, una agencia argentina que hace videos comerciales verticales (Reels) para negocios, los publica y los pauta en Meta. Armá un PRESUPUESTO para un cliente nuevo a partir de lo que te pasan (lo que cuenta el admin, capturas, un PDF o un chat de WhatsApp con el cliente).

Reglas:
- Sacá del material: nombre de la empresa, nombre del contacto, su WhatsApp/teléfono y email si aparecen.
- Si lo que pide encaja con un plan de Prodi, elegí ese plan en "plan_id" (exacto, de la lista) y NO lo repitas en "items". Si no encaja, "plan_id" vacío y armá los ítems.
- "items": lo que se cobra aparte del plan (jornada de filmación extra, edición, piezas gráficas, manejo de pauta, producción especial, etc.). Cada ítem: concepto corto, detalle (qué incluye, 1 frase), cantidad, precio (número entero sin símbolos, en la moneda elegida) y periodo ("mensual" o "unico").
- Precios: si en el material se habló de un precio, usalo. Si no, usá los de los planes y presupuestos anteriores como referencia. No inventes descuentos.
- "moneda": "ARS" salvo que se hable en dólares. "tipo": "factura" (con IVA ${iva}%) salvo que pidan sin factura → "boleta".
- "validez_dias": cuántos días vale (por defecto 15).
- "nota": mensaje corto y cálido para el cliente (2 a 3 frases, voseo), que retome lo que charlaron.
- "resumen": 1 o 2 frases para el admin explicando qué armaste y por qué.
- "faltantes": datos importantes que no pudiste deducir (ej. "No encontré el WhatsApp del contacto", "No se habló de precio de la jornada: usé el de referencia"). Vacío si no falta nada.
- Español rioplatense.

Planes de Prodi:
${planes || "(no hay planes cargados)"}

Precios usados en presupuestos anteriores (referencia):
${previos || "(todavía no hay presupuestos)"}

${b.actual ? `Lo que ya está cargado en el formulario (completalo o corregilo):\n${t(JSON.stringify(b.actual), 3000)}\n` : ""}
${texto ? `Lo que cuenta el admin:\n${texto}\n` : ""}
${chat ? `Chat de WhatsApp exportado con el cliente:\n${chat}\n` : ""}
${adjuntos.length ? `Además te adjunto ${adjuntos.length} archivo(s) (capturas o PDF): leelos con atención.` : ""}`;

  const r = await generarJSON<any>(
    prompt,
    {
      type: "OBJECT",
      properties: {
        empresa: { type: "STRING" },
        contacto: { type: "OBJECT", properties: { nombre: { type: "STRING" }, telefono: { type: "STRING" }, email: { type: "STRING" } } },
        plan_id: { type: "STRING" },
        items: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { concepto: { type: "STRING" }, detalle: { type: "STRING" }, cantidad: { type: "NUMBER" }, precio: { type: "NUMBER" }, periodo: { type: "STRING", enum: ["mensual", "unico"] } },
            required: ["concepto", "cantidad", "precio", "periodo"],
          },
        },
        moneda: { type: "STRING", enum: ["ARS", "USD"] },
        tipo: { type: "STRING", enum: ["factura", "boleta"] },
        validez_dias: { type: "NUMBER" },
        nota: { type: "STRING" },
        resumen: { type: "STRING" },
        faltantes: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["empresa", "items", "moneda", "tipo", "nota", "resumen", "faltantes"],
    },
    0.4,
    adjuntos
  );

  const idsPlanes = new Set(planesSnap.docs.map((d) => d.id));
  return {
    empresa: t(r.empresa, 120),
    contacto: { nombre: t(r.contacto?.nombre, 120) || null, telefono: t(r.contacto?.telefono, 40) || null, email: t(r.contacto?.email, 120) || null },
    plan_id: idsPlanes.has(String(r.plan_id)) ? String(r.plan_id) : null,
    items: (Array.isArray(r.items) ? r.items : [])
      .map((i: any) => ({
        concepto: t(i.concepto, 120),
        detalle: t(i.detalle, 300) || null,
        cantidad: Math.max(1, Math.round(Number(i.cantidad) || 1)),
        precio: Math.max(0, Math.round(Number(i.precio) || 0)),
        periodo: i.periodo === "unico" ? "unico" : "mensual",
      }))
      .filter((i: any) => i.concepto)
      .slice(0, 15),
    moneda: r.moneda === "USD" ? "USD" : "ARS",
    tipo: r.tipo === "boleta" ? "boleta" : "factura",
    validez_dias: Math.min(90, Math.max(1, Math.round(Number(r.validez_dias) || 15))),
    nota: t(r.nota, 800),
    resumen: t(r.resumen, 400),
    faltantes: (Array.isArray(r.faltantes) ? r.faltantes : []).map((x: unknown) => t(x, 200)).filter(Boolean).slice(0, 6),
  };
}
