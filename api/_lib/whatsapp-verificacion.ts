// Vincular el WhatsApp de un usuario: el código lo genera y lo controla el servidor.
// El código se guarda hasheado en whatsapp_verifications/{uid} (la app no lo puede leer ni escribir)
// y sale por la misma cola del bot que los avisos (notification_queue).
// Recién al acertar el código se escriben whatsapp_phone y whatsapp_phone_verified en el perfil.

import crypto from "crypto";
import { adminDb } from "./db";
import { HttpError } from "./auth";

const COLECCION = "whatsapp_verifications";
const EXPIRA_MIN = 10;
const ESPERA_REENVIO_SEG = 60;
const MAX_INTENTOS = 5;

/** Igual que normalizeWhatsAppPhone de la app. */
export function normalizarTelefono(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("54")) return `+${digits}`;
  if (digits.startsWith("0")) return `+54${digits.slice(1)}`;
  if (digits.length >= 10) return `+54${digits}`;
  return `+${digits}`;
}

const telefonoValido = (normalizado: string) => /^\+54\d{10,11}$/.test(normalizado);

function clave(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("Falta AUTH_SECRET (mínimo 32 caracteres) en las variables de entorno.");
  return crypto.createHmac("sha256", s).update("prodi:whatsapp-codigo:v1").digest();
}

const hashCodigo = (uid: string, telefono: string, codigo: string) =>
  crypto.createHmac("sha256", clave()).update(`${uid}:${telefono}:${codigo}`).digest("base64url");

async function usadoPorOtro(uid: string, normalizado: string): Promise<boolean> {
  const snap = await adminDb().collection("profiles").where("whatsapp_phone", "==", normalizado).get();
  return snap.docs.some((d) => d.id !== uid && d.data().whatsapp_phone_verified !== false);
}

/** Genera el código y lo manda por WhatsApp al número que se quiere vincular. */
export async function pedirCodigoWhatsapp(uid: string, raw: unknown): Promise<{ ok: true }> {
  const normalizado = normalizarTelefono(String(raw ?? "").slice(0, 40));
  if (!telefonoValido(normalizado)) throw new HttpError(400, "El número de WhatsApp no es válido");
  if (await usadoPorOtro(uid, normalizado)) throw new HttpError(409, "Ese número ya está vinculado a otra cuenta");

  const db = adminDb();
  const ref = db.collection(COLECCION).doc(uid);
  const prev = (await ref.get()).data();
  if (prev?.created_at && prev.status !== "verified") {
    const pasaron = (Date.now() - new Date(String(prev.created_at)).getTime()) / 1000;
    if (pasaron < ESPERA_REENVIO_SEG) {
      throw new HttpError(429, `Esperá ${Math.ceil(ESPERA_REENVIO_SEG - pasaron)}s antes de pedir otro código`);
    }
  }

  const codigo = String(crypto.randomInt(100000, 1000000));
  const ahora = new Date();
  const phone = normalizado.replace(/\D/g, "");
  await ref.set({
    user_id: uid,
    phone,
    phone_display: normalizado,
    code_hash: hashCodigo(uid, normalizado, codigo),
    status: "pending",
    attempts: 0,
    created_at: ahora.toISOString(),
    expires_at: new Date(ahora.getTime() + EXPIRA_MIN * 60_000).toISOString(),
  });

  // Mismo formato que los avisos (notify.ts): el bot manda payload.text tal cual.
  const texto = `*Prodi*\nTu código para vincular WhatsApp es *${codigo}*. Vence en ${EXPIRA_MIN} minutos.\nSi no lo pediste, ignorá este mensaje.`;
  await db.collection("notification_queue").add({
    type: "prodi_aviso",
    task_id: null,
    recipient_user_id: uid,
    phone,
    send_whatsapp: true,
    send_push: false,
    // Es un código: no espera al horario de envío de los avisos.
    urgente: true,
    payload: { text: texto, title: "Código de verificación", body: texto, url: "" },
    dedupe_key: `whatsapp_codigo:${uid}:${ahora.getTime()}`,
    scheduled_at: ahora.toISOString(),
    status: "pending",
    created_at: ahora.toISOString(),
  });
  return { ok: true };
}

/** Controla el código y, si está bien, vincula el número al perfil. */
export async function confirmarCodigoWhatsapp(uid: string, raw: unknown): Promise<{ ok: true; whatsapp_phone: string }> {
  const codigo = String(raw ?? "").replace(/\D/g, "");
  if (codigo.length !== 6) throw new HttpError(400, "Ingresá el código de 6 dígitos");

  const db = adminDb();
  const ref = db.collection(COLECCION).doc(uid);
  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const v = snap.data();
    if (!v || typeof v.code_hash !== "string") return { error: "No hay verificación en curso. Pedí un código nuevo.", status: 404 };
    if (v.status === "verified") return { error: "Este número ya fue verificado", status: 409 };
    if (!v.expires_at || new Date(String(v.expires_at)).getTime() < Date.now()) {
      tx.delete(ref);
      return { error: "El código expiró. Pedí uno nuevo.", status: 410 };
    }
    const intentos = Number(v.attempts) || 0;
    if (intentos >= MAX_INTENTOS) {
      tx.delete(ref);
      return { error: "Demasiados intentos. Pedí un código nuevo.", status: 429 };
    }
    const a = Buffer.from(hashCodigo(uid, String(v.phone_display), codigo));
    const b = Buffer.from(v.code_hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      tx.update(ref, { attempts: intentos + 1 });
      return { error: "Código incorrecto", status: 400 };
    }
    tx.update(ref, { status: "verified", verified_at: new Date().toISOString() });
    return { telefono: String(v.phone_display) };
  });
  if ("error" in resultado) throw new HttpError(resultado.status as number, resultado.error as string);

  const telefono = resultado.telefono;
  if (await usadoPorOtro(uid, telefono)) {
    await ref.delete();
    throw new HttpError(409, "Ese número ya está vinculado a otra cuenta");
  }
  await db.collection("profiles").doc(uid).set(
    { whatsapp_phone: telefono, whatsapp_phone_verified: true, whatsapp_enabled: true },
    { merge: true }
  );
  return { ok: true, whatsapp_phone: telefono };
}

export async function desvincularWhatsapp(uid: string): Promise<{ ok: true }> {
  const db = adminDb();
  await db.collection("profiles").doc(uid).set(
    { whatsapp_phone: "", whatsapp_phone_verified: false, whatsapp_enabled: false },
    { merge: true }
  );
  await db.collection(COLECCION).doc(uid).delete().catch(() => undefined);
  return { ok: true };
}
