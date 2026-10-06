// Vincular el WhatsApp: el código lo genera, lo manda y lo controla el servidor
// (/api/usuarios/whatsapp-*). La app no puede escribir el número verificado en el perfil.

import { callApi } from "@/lib/redes/api";
import { isValidWhatsAppPhone } from "@/lib/whatsappNotifications";

export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_EXPIRY_MINUTES = 10;
export const VERIFICATION_RESEND_COOLDOWN_SEC = 60;
export const VERIFICATION_MAX_ATTEMPTS = 5;

export const isWhatsAppPhoneVerified = (
  data: Record<string, unknown> | undefined
): boolean => {
  if (!data?.whatsapp_phone) return false;
  if (data.whatsapp_phone_verified === true) return true;
  // Usuarios que ya tenían número antes de la verificación.
  return data.whatsapp_phone_verified !== false;
};

/** Pide el código: el servidor lo manda por WhatsApp al número. */
export async function requestPhoneVerification(
  _userId: string,
  rawPhone: string
): Promise<void> {
  if (!isValidWhatsAppPhone(rawPhone)) {
    throw new Error("El número de WhatsApp no es válido");
  }
  await callApi("/api/usuarios/whatsapp-codigo", { telefono: rawPhone });
}

/** Confirma el código; devuelve el número vinculado (normalizado). */
export async function confirmPhoneVerification(
  _userId: string,
  inputCode: string
): Promise<string> {
  const code = inputCode.replace(/\D/g, "");
  if (code.length !== VERIFICATION_CODE_LENGTH) {
    throw new Error("Ingresá el código de 6 dígitos");
  }
  const r = await callApi<{ whatsapp_phone: string }>("/api/usuarios/whatsapp-verificar", { codigo: code });
  return r.whatsapp_phone;
}

export async function unlinkWhatsAppPhone(_userId: string): Promise<void> {
  await callApi("/api/usuarios/whatsapp-desvincular", {});
}
