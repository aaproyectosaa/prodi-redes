import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/** Credenciales de las apps de Mercado Pago: cifradas con la clave de Prodi (la misma de los tokens de Drive). */
function keyBytes() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) throw new Error("Falta TOKEN_ENCRYPTION_KEY en el servidor");
  return createHash("sha256").update(`prodi-software:${raw}`).digest();
}

export function encrypt(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(payload: string): string {
  if (!payload) return "";
  if (!payload.startsWith("v1:")) return payload;
  const [, ivB64, tagB64, dataB64] = payload.split(":");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return "";
  const plain = value.startsWith("v1:") ? "••••••••" : value;
  if (plain.length <= 8) return "••••••••";
  return `${plain.slice(0, 4)}••••${plain.slice(-4)}`;
}
