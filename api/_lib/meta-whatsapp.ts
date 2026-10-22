/* eslint-disable @typescript-eslint/no-explicit-any */
// WhatsApp de Prodi → leads. El número de siempre se conecta a la app de Meta con el "registro integrado" en modo
// coexistencia (se sigue usando la app WhatsApp Business del celular). Meta avisa cada mensaje al mismo webhook de
// Leads (/api/web/meta-webhook, objeto "whatsapp_business_account"): quien escribe por primera vez entra como lead con
// aviso; si ya es lead, el mensaje se suma a su línea de tiempo. Los mensajes que manda Prodi desde la app no crean nada.
// Se guarda cifrado en `secretos/meta_whatsapp`: la cuenta (WABA), el número y su token.

import { getPool, guardarDoc, leerDoc } from "./db";
import { adminDb } from "./db";
import { HttpError } from "./http";
import { enviarAviso } from "./notify";
import { decrypt, encrypt, type EncryptedPayload } from "./crypto";
import { graph, idDeLead, limpio, temporadaActual } from "./meta-leads";

const COL = "leads_web";
const SECRETO = { col: "secretos", id: "meta_whatsapp" };
const VERSION = () => process.env.META_GRAPH_VERSION || "v23.0";
const APP_ID = () => (process.env.META_APP_ID ?? "1702831641421860").trim();

/** Para la pantalla: si está conectado, el número y el ID de configuración del registro integrado. */
export async function estadoWhatsApp() {
  const d = await leerDoc(getPool(), SECRETO.col, SECRETO.id);
  return {
    conectado: !!d?.cifrado,
    numero: (d?.numero as string) ?? null,
    nombre: (d?.nombre as string) ?? null,
    config_id: (d?.config_id as string) ?? "",
    app_id: APP_ID(),
    ultimo_mensaje_at: (d?.ultimo_mensaje_at as string) ?? null,
  };
}

/** Guarda el ID de configuración de "Inicio de sesión con Facebook para empresas" (lo crea el admin en la app). */
export async function guardarConfigWhatsApp(configId: string) {
  const id = String(configId ?? "").trim();
  if (!/^\d{6,25}$/.test(id)) throw new HttpError(400, "Pegá el ID de configuración (solo números)");
  const d = (await leerDoc(getPool(), SECRETO.col, SECRETO.id)) ?? {};
  await guardarDoc(getPool(), SECRETO.col, SECRETO.id, { ...d, config_id: id, updated_at: new Date().toISOString() });
  return { ok: true };
}

/**
 * Termina el registro integrado: cambia el código por el token del negocio, suscribe la app a la cuenta de WhatsApp
 * (para que lleguen los mensajes) y lo guarda.
 */
export async function conectarWhatsApp(b: { code?: string; waba_id?: string; phone_number_id?: string }) {
  const code = String(b.code ?? "").trim();
  const waba = String(b.waba_id ?? "").trim();
  const telId = String(b.phone_number_id ?? "").trim();
  if (!code || !/^\d+$/.test(waba) || !/^\d+$/.test(telId)) throw new HttpError(400, "Faltan datos del registro de WhatsApp. Probá de nuevo.");
  const secret = process.env.META_APP_SECRET?.replace(/[\s"']/g, "");
  if (!secret) throw new HttpError(500, "Falta META_APP_SECRET en Vercel");
  const r = await fetch(
    `https://graph.facebook.com/${VERSION()}/oauth/access_token?${new URLSearchParams({ client_id: APP_ID(), client_secret: secret, code })}`
  ).then((x) => x.json() as Promise<any>);
  if (!r?.access_token) throw new HttpError(400, `Meta: ${r?.error?.message ?? "no aceptó el código"}`);
  const token = String(r.access_token);
  // Sin esto no llegan los mensajes al webhook.
  await graph(`${waba}/subscribed_apps`, {}, token, "POST");
  const tel = await graph(telId, { fields: "display_phone_number,verified_name" }, token).catch(() => ({}));
  const d = (await leerDoc(getPool(), SECRETO.col, SECRETO.id)) ?? {};
  await guardarDoc(getPool(), SECRETO.col, SECRETO.id, {
    ...d,
    waba_id: waba,
    phone_number_id: telId,
    numero: tel.display_phone_number ?? null,
    nombre: tel.verified_name ?? null,
    cifrado: encrypt(token),
    conectado_at: new Date().toISOString(),
  });
  return { ok: true, numero: tel.display_phone_number ?? null, nombre: tel.verified_name ?? null };
}

/** Texto de un mensaje de WhatsApp (o qué es, si no es texto). */
function textoDe(m: any): string {
  if (m?.type === "text") return String(m.text?.body ?? "");
  if (m?.type === "button") return String(m.button?.text ?? "");
  if (m?.type === "interactive") return String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "");
  const tipos: Record<string, string> = { image: "Mandó una foto", audio: "Mandó un audio", video: "Mandó un video", document: "Mandó un archivo", sticker: "Mandó un sticker", location: "Mandó una ubicación", contacts: "Mandó un contacto", reaction: "Reaccionó a un mensaje" };
  const extra = m?.[m?.type]?.caption ? `: ${m[m.type].caption}` : "";
  return `${tipos[m?.type] ?? "Mandó un mensaje"}${extra}`;
}

/** POST del webhook con objeto "whatsapp_business_account": mensajes nuevos al WhatsApp de Prodi. */
export async function recibirWhatsApp(b: any, base: string) {
  const conf = await leerDoc(getPool(), SECRETO.col, SECRETO.id);
  let nuevos = 0;
  for (const e of Array.isArray(b?.entry) ? b.entry : [])
    for (const c of Array.isArray(e?.changes) ? e.changes : []) {
      if (c?.field !== "messages") continue;
      const v = c.value ?? {};
      // Solo el número conectado (lo demás se ignora: no se confía en lo que llega).
      if (!conf?.phone_number_id || String(v.metadata?.phone_number_id) !== String(conf.phone_number_id)) continue;
      const nombres = new Map<string, string>((v.contacts ?? []).map((x: any) => [String(x.wa_id), String(x.profile?.name ?? "")]));
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        if (await guardarMensaje(m, nombres.get(String(m.from)) ?? "", base)) nuevos++;
      }
    }
  if (conf && nuevos) await guardarDoc(getPool(), SECRETO.col, SECRETO.id, { ...conf, ultimo_mensaje_at: new Date().toISOString() });
  return { ok: true, nuevos };
}

/** Un mensaje: crea el lead o lo suma a su línea de tiempo. Devuelve true si es un lead nuevo. */
async function guardarMensaje(m: any, nombrePerfil: string, base: string): Promise<boolean> {
  const wa = String(m?.from ?? "").replace(/\D/g, "");
  if (!wa) return false;
  const id = idDeLead(`whatsapp:${wa}`);
  const pool = getPool();
  const texto = limpio(textoDe(m), 1000);
  const at = m?.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
  const lead = (await leerDoc(pool, COL, id)) as any;
  const vistos: string[] = Array.isArray(lead?.meta?.wa_vistos) ? lead.meta.wa_vistos : [];
  if (m?.id && vistos.includes(String(m.id))) return false; // Meta a veces avisa dos veces.
  const nombre = limpio(nombrePerfil, 80);
  const telefono = `+${wa}`;
  const admins = async () => (await adminDb().collection("profiles").where("role", "==", "admin").get()).docs.filter((d) => d.data().activo !== false).map((d) => d.id);

  if (lead) {
    await guardarDoc(pool, COL, id, {
      ...lead,
      updated_at: new Date().toISOString(),
      meta: { ...(lead.meta ?? {}), ultimo_texto: limpio(texto, 300), ultimo_mensaje_at: at, wa_vistos: [...vistos, String(m.id ?? "")].slice(-50) },
      historial: [...(Array.isArray(lead.historial) ? lead.historial : []), { at, tipo: "whatsapp", texto: `Escribió por WhatsApp: «${limpio(texto, 500)}»`, por: null, por_nombre: "WhatsApp" }].slice(-100),
    });
    await enviarAviso(
      { destinatarios: await admins(), titulo: `💬 ${lead.negocio || nombre || telefono} te escribió por WhatsApp`, cuerpo: `«${limpio(texto, 140)}»`, link: `/web?lead=${id}`, clave: `lead-wa:${m.id ?? at}` },
      base
    ).catch(() => undefined);
    return false;
  }

  await guardarDoc(pool, COL, id, {
    created_at: at,
    updated_at: new Date().toISOString(),
    temporada: await temporadaActual(),
    nombre,
    negocio: nombre || telefono,
    email: "",
    telefono,
    instagram: "",
    ubicacion: "",
    rubro: "",
    califica: true,
    dudoso: false,
    estado: "calificado",
    notas: "",
    manual: true,
    fuente: "WhatsApp",
    origen: "meta:whatsapp",
    meta: { plataforma: "whatsapp", wa_id: wa, ultimo_texto: limpio(texto, 300), ultimo_mensaje_at: at, wa_vistos: [String(m.id ?? "")] },
    historial: [
      { at, de: null, a: "calificado", por: null, por_nombre: "WhatsApp" },
      { at, tipo: "whatsapp", texto: `Escribió por WhatsApp: «${limpio(texto, 500)}»`, por: null, por_nombre: "WhatsApp" },
    ],
  });
  await enviarAviso(
    { destinatarios: await admins(), titulo: `💬 Nuevo lead por WhatsApp: ${nombre || telefono}`, cuerpo: texto ? `«${limpio(texto, 140)}»` : "Escribió por WhatsApp.", link: `/web?lead=${id}`, clave: `lead-wa:${m.id ?? at}` },
    base
  ).catch(() => undefined);
  return true;
}

/** Token guardado (por si más adelante se responde desde el CRM). */
export async function tokenWhatsApp(): Promise<string | null> {
  const d = await leerDoc(getPool(), SECRETO.col, SECRETO.id);
  try {
    return d?.cifrado ? decrypt(d.cifrado as EncryptedPayload) : null;
  } catch {
    return null;
  }
}
