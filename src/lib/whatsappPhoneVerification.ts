import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import {
  isValidWhatsAppPhone,
  normalizeWhatsAppPhone,
} from "@/lib/whatsappNotifications";

export const WHATSAPP_VERIFICATIONS_COLLECTION = "whatsapp_verifications";
export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_EXPIRY_MINUTES = 10;
export const VERIFICATION_RESEND_COOLDOWN_SEC = 60;
export const VERIFICATION_MAX_ATTEMPTS = 5;

const generateVerificationCode = (): string =>
  String(Math.floor(100000 + Math.random() * 900000));

const verificationRef = (userId: string) =>
  doc(db, WHATSAPP_VERIFICATIONS_COLLECTION, userId);

export const isWhatsAppPhoneVerified = (
  data: Record<string, unknown> | undefined
): boolean => {
  if (!data?.whatsapp_phone) return false;
  if (data.whatsapp_phone_verified === true) return true;
  // Usuarios que ya tenían número antes de la verificación.
  return data.whatsapp_phone_verified !== false;
};

export async function isPhoneUsedByAnotherUser(
  userId: string,
  normalizedPhone: string
): Promise<boolean> {
  const snap = await getDocs(
    query(collection(db, "profiles"), where("whatsapp_phone", "==", normalizedPhone))
  );
  return snap.docs.some((d) => {
    if (d.id === userId) return false;
    const data = d.data();
    return data.whatsapp_phone_verified !== false;
  });
}

export async function requestPhoneVerification(
  userId: string,
  rawPhone: string
): Promise<void> {
  if (!isValidWhatsAppPhone(rawPhone)) {
    throw new Error("El número de WhatsApp no es válido");
  }

  const normalized = normalizeWhatsAppPhone(rawPhone);
  const phoneDigits = normalized.replace(/\D/g, "");

  if (await isPhoneUsedByAnotherUser(userId, normalized)) {
    throw new Error("Ese número ya está vinculado a otra cuenta");
  }

  const existing = await getDoc(verificationRef(userId));
  if (existing.exists()) {
    const data = existing.data();
    const createdAt = data.created_at as string | undefined;
    if (createdAt && data.status !== "verified") {
      const elapsed = (Date.now() - new Date(createdAt).getTime()) / 1000;
      if (elapsed < VERIFICATION_RESEND_COOLDOWN_SEC) {
        const wait = Math.ceil(VERIFICATION_RESEND_COOLDOWN_SEC - elapsed);
        throw new Error(`Esperá ${wait}s antes de pedir otro código`);
      }
    }
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + VERIFICATION_EXPIRY_MINUTES * 60 * 1000
  );

  await setDoc(verificationRef(userId), {
    user_id: userId,
    phone: phoneDigits,
    phone_display: normalized,
    code: generateVerificationCode(),
    status: "pending",
    attempts: 0,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
}

export async function confirmPhoneVerification(
  userId: string,
  inputCode: string
): Promise<string> {
  const code = inputCode.replace(/\D/g, "");
  if (code.length !== VERIFICATION_CODE_LENGTH) {
    throw new Error("Ingresá el código de 6 dígitos");
  }

  const snap = await getDoc(verificationRef(userId));
  if (!snap.exists()) {
    throw new Error("No hay verificación en curso. Pedí un código nuevo.");
  }

  const data = snap.data();
  if (data.status === "verified") {
    throw new Error("Este número ya fue verificado");
  }

  const expiresAt = data.expires_at as string | undefined;
  if (!expiresAt || new Date(expiresAt) < new Date()) {
    await deleteDoc(verificationRef(userId));
    throw new Error("El código expiró. Pedí uno nuevo.");
  }

  const attempts = (data.attempts as number) ?? 0;
  if (attempts >= VERIFICATION_MAX_ATTEMPTS) {
    await deleteDoc(verificationRef(userId));
    throw new Error("Demasiados intentos. Pedí un código nuevo.");
  }

  if (data.code !== code) {
    await setDoc(
      verificationRef(userId),
      { attempts: attempts + 1 },
      { merge: true }
    );
    throw new Error("Código incorrecto");
  }

  const normalized = (data.phone_display as string) || "";
  if (await isPhoneUsedByAnotherUser(userId, normalized)) {
    await deleteDoc(verificationRef(userId));
    throw new Error("Ese número ya está vinculado a otra cuenta");
  }

  const profileRef = doc(db, "profiles", userId);
  await setDoc(
    profileRef,
    {
      whatsapp_phone: normalized,
      whatsapp_phone_verified: true,
      whatsapp_enabled: true,
    },
    { merge: true }
  );

  await setDoc(
    verificationRef(userId),
    { status: "verified", verified_at: new Date().toISOString() },
    { merge: true }
  );

  return normalized;
}

export async function unlinkWhatsAppPhone(userId: string): Promise<void> {
  const profileRef = doc(db, "profiles", userId);
  await setDoc(
    profileRef,
    {
      whatsapp_phone: "",
      whatsapp_phone_verified: false,
      whatsapp_enabled: false,
    },
    { merge: true }
  );

  try {
    await deleteDoc(verificationRef(userId));
  } catch {
    // Sin verificación pendiente.
  }
}
