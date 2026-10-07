/* eslint-disable @typescript-eslint/no-explicit-any */
// Informe mensual del cliente: datos + HTML de mail (compatible con Gmail/Outlook).

import { adminDb } from "./db";
import { renderInformeHtml } from "./informe-html";
import { mesAR, sumarMeses } from "./fecha";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function mesLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const n = MESES[m - 1] ?? "";
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${y}`;
}

/** Mes anterior según hora de Argentina. */
export function mesAnteriorAR(now = new Date()): string {
  return sumarMeses(mesAR(now), -1);
}

export interface Informe {
  proyectoId: string;
  nombre: string;
  mes: string;
  destinatarios: string[];
  asunto: string;
  html: string;
  resumen: {
    publicados: number;
    planificados: number;
    cupo: number;
    alcance: number;
    reproducciones: number;
    mensajes: number;
    gasto: number;
  };
}

export async function construirInforme(proyectoId: string, mes: string, baseUrl: string): Promise<Informe> {
  const db = adminDb();
  const pSnap = await db.collection("projects").doc(proyectoId).get();
  if (!pSnap.exists) throw new Error("Cliente no encontrado");
  const p = pSnap.data()!;
  const vSnap = await db.collection("videos").where("proyecto_id", "==", proyectoId).where("mes", "==", mes).get();
  const videos = vSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
  const publicados = videos.filter((v) => v.etapa === "publicado");

  let cupo = Number(p.plan_redes_override?.videos_mes ?? 0);
  if (!cupo && p.plan_redes_id) {
    const plan = (await db.collection("planes_redes").doc(p.plan_redes_id).get()).data();
    cupo = Number(plan?.videos_mes ?? 0);
  }
  cupo += Number(p.creditos_extra?.[mes] ?? 0);

  const sum = (k: string) => publicados.reduce((a, v) => a + Number(v.resultados?.[k] ?? 0), 0);
  const resumen = {
    publicados: publicados.length,
    planificados: videos.filter((v) => !v.extra).length,
    cupo,
    alcance: sum("alcance"),
    reproducciones: sum("reproducciones"),
    mensajes: sum("mensajes"),
    gasto: sum("gasto"),
  };
  const html = renderInformeHtml({ nombre: String(p.nombre ?? ""), label: mesLabel(mes), baseUrl, resumen, publicados });
  return {
    proyectoId,
    nombre: String(p.nombre ?? ""),
    mes,
    destinatarios: (p.contacto_emails ?? []) as string[],
    asunto: `Tu informe de ${mesLabel(mes)} · Prodi`,
    html,
    resumen,
  };
}

/** Envía por Resend. */
export async function enviarMail(to: string[], asunto: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Falta RESEND_API_KEY en Vercel");
  const from = process.env.INFORME_FROM || "Prodi <informes@somosprodi.com>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: asunto, html, reply_to: process.env.INFORME_REPLY_TO || undefined }),
  });
  if (!res.ok) {
    const j: any = await res.json().catch(() => ({}));
    throw new Error(`No se pudo enviar el mail: ${j?.message ?? res.status}`);
  }
}

export interface MailLote {
  to: string;
  asunto: string;
  html: string;
}

/**
 * Varios mails en un solo pedido a Resend (/emails/batch, hasta 100 por pedido; los lotes van de a 3 en paralelo).
 * Nunca tira: si falla, lo deja en el log. Sin RESEND_API_KEY no hace nada.
 */
export async function enviarMailsLote(mails: MailLote[]): Promise<number> {
  const key = process.env.RESEND_API_KEY;
  if (!mails.length) return 0;
  if (!key) {
    console.warn("[mail] Falta RESEND_API_KEY: no se mandan los avisos por correo");
    return 0;
  }
  const from = process.env.INFORME_FROM || "Prodi <informes@somosprodi.com>";
  const replyTo = process.env.INFORME_REPLY_TO || undefined;
  const lotes: MailLote[][] = [];
  for (let i = 0; i < mails.length; i += 100) lotes.push(mails.slice(i, i + 100));
  let enviados = 0;
  for (let i = 0; i < lotes.length; i += 3) {
    await Promise.all(
      lotes.slice(i, i + 3).map(async (lote) => {
        try {
          const res = await fetch("https://api.resend.com/emails/batch", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(lote.map((m) => ({ from, to: [m.to], subject: m.asunto, html: m.html, reply_to: replyTo }))),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            const j: any = await res.json().catch(() => ({}));
            console.warn("[mail] lote rechazado", res.status, j?.message ?? "");
            return;
          }
          enviados += lote.length;
        } catch (err) {
          console.warn("[mail] lote falló", err);
        }
      })
    );
  }
  return enviados;
}
