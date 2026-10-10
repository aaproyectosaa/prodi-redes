// Usuarios y sesiones de Prodi Redes (reemplaza a Firebase Auth).
//
// - Las contraseñas se guardan con scrypt (sal al azar por usuario), nunca en texto.
// - La sesión es un token firmado con AUTH_SECRET (HMAC-SHA256) que dura 30 días.
//   Cambiar la contraseña o desactivar al usuario sube `sesion_ver` y corta todas sus sesiones.
// - Los links para crear o cambiar la contraseña son tokens de un solo uso (vencen en 3 días).

import { createCipheriv, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { getPool } from "./db";
import { nuevoId } from "./docs";

const scrypt = promisify(scryptCb) as (pwd: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384;

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Contraseñas
// ---------------------------------------------------------------------------

export async function hashClave(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const h = await scrypt(clave, sal, 64, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${sal.toString("base64")}$${h.toString("base64")}`;
}

/**
 * Contraseñas que vinieron de Firebase (scrypt modificado de Firebase): se validan con los
 * parámetros del proyecto (Authentication → Users → ⋮ → Password hash parameters).
 * Así nadie tiene que cambiar su contraseña al migrar; al entrar, se guarda en el formato nuevo.
 */
async function verificarClaveFirebase(clave: string, salB64: string, hB64: string, proyecto?: string): Promise<boolean> {
  // Cada proyecto de Firebase tiene sus parámetros: "fbscrypt$sal$hash$postgo" usa FIREBASE_HASH_POSTGO_*.
  const p = proyecto && /^[a-z0-9]+$/.test(proyecto) ? `FIREBASE_HASH_${proyecto.toUpperCase()}_` : "FIREBASE_HASH_";
  const signer = process.env[`${p}SIGNER_KEY`];
  const sep = process.env[`${p}SALT_SEPARATOR`];
  if (!signer || !sep) return false;
  const rounds = Number(process.env[`${p}ROUNDS`] ?? 8);
  const mem = Number(process.env[`${p}MEM_COST`] ?? 14);
  const sal = Buffer.concat([Buffer.from(salB64, "base64"), Buffer.from(sep, "base64")]);
  const dk = await scrypt(clave, sal, 64, { N: 2 ** mem, r: rounds, p: 1, maxmem: 256 * 1024 * 1024 });
  const c = createCipheriv("aes-256-ctr", dk.subarray(0, 32), Buffer.alloc(16, 0));
  const h = Buffer.concat([c.update(Buffer.from(signer, "base64")), c.final()]);
  const esperado = Buffer.from(hB64, "base64");
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}

export async function verificarClave(clave: string, guardado: string | null | undefined): Promise<boolean> {
  if (!guardado) return false;
  const [alg, n, salB64, hB64] = guardado.split("$");
  if (alg === "fbscrypt") return verificarClaveFirebase(clave, n, salB64, hB64);
  if (alg !== "scrypt") return false;
  const esperado = Buffer.from(hB64, "base64");
  const h = await scrypt(clave, Buffer.from(salB64, "base64"), esperado.length, { N: Number(n), r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}

export function validarClave(clave: string) {
  if (typeof clave !== "string" || clave.length < 8) throw new AuthError("auth/weak-password", "La contraseña tiene que tener al menos 8 caracteres");
  if (/^(\d+|(.)\2+|12345678\d*|password\d*|contraseña\d*|prodi\d*|qwerty\d*)$/i.test(clave)) throw new AuthError("auth/weak-password", "Esa contraseña es muy fácil de adivinar. Elegí otra.");
}

// ---------------------------------------------------------------------------
// Tokens firmados
// ---------------------------------------------------------------------------

function secreto(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("Falta AUTH_SECRET (mínimo 32 caracteres) en las variables de entorno.");
  return Buffer.from(s);
}
const b64u = (b: Buffer) => b.toString("base64url");

interface Payload {
  uid: string;
  /** s = sesión, r = cambiar contraseña */
  t: "s" | "r";
  v: number;
  exp: number;
  /** En links de contraseña: huella de la clave actual (al cambiarla, el link deja de servir). */
  h?: string;
}

function firmar(p: Payload): string {
  const cuerpo = b64u(Buffer.from(JSON.stringify(p)));
  const firma = b64u(createHmac("sha256", secreto()).update(cuerpo).digest());
  return `v1.${cuerpo}.${firma}`;
}

function abrir(token: string): Payload | null {
  const [ver, cuerpo, firma] = String(token ?? "").split(".");
  if (ver !== "v1" || !cuerpo || !firma) return null;
  const esperada = createHmac("sha256", secreto()).update(cuerpo).digest();
  const dada = Buffer.from(firma, "base64url");
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  try {
    const p = JSON.parse(Buffer.from(cuerpo, "base64url").toString()) as Payload;
    if (!p.uid || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

const huella = (hash: string | null) => (hash ? createHmac("sha256", secreto()).update(hash).digest("base64url").slice(0, 12) : "sin");

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

export interface Usuario {
  uid: string;
  email: string;
  nombre: string | null;
  desactivado: boolean;
  sesion_ver: number;
  clave_hash: string | null;
}

async function porUid(uid: string): Promise<Usuario | null> {
  const r = await getPool().query("select uid, email, nombre, desactivado, sesion_ver, clave_hash from usuarios where uid = $1", [uid]);
  return r.rows[0] ?? null;
}
async function porEmail(email: string): Promise<Usuario | null> {
  const r = await getPool().query("select uid, email, nombre, desactivado, sesion_ver, clave_hash from usuarios where email = $1", [
    email.trim().toLowerCase(),
  ]);
  return r.rows[0] ?? null;
}

const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function crearUsuario(datos: { email: string; password?: string | null; displayName?: string | null; uid?: string }): Promise<{ uid: string; email: string }> {
  const email = String(datos.email ?? "").trim().toLowerCase();
  if (!emailValido(email)) throw new AuthError("auth/invalid-email", "El mail no es válido");
  if (datos.password) validarClave(datos.password);
  const uid = datos.uid ?? nuevoId();
  const hash = datos.password ? await hashClave(datos.password) : null;
  const r = await getPool().query(
    "insert into usuarios (uid, email, clave_hash, nombre) values ($1, $2, $3, $4) on conflict do nothing returning uid",
    [uid, email, hash, datos.displayName ?? null]
  );
  if (!r.rowCount) throw new AuthError("auth/email-already-exists", "Ya existe un usuario con ese mail");
  return { uid, email };
}

// Intentos fallidos de login (para frenar a quien prueba contraseñas): por mail y por IP, en la base.
let tablaIntentos: Promise<unknown> | null = null;
function asegurarTablaIntentos() {
  tablaIntentos ??= getPool()
    .query("create table if not exists login_intentos (clave text not null, at timestamptz not null default now()); create index if not exists login_intentos_idx on login_intentos (clave, at)")
    .catch((err) => {
      tablaIntentos = null;
      throw err;
    });
  return tablaIntentos;
}
const MAX_POR_MAIL = 8;
const MAX_POR_IP = 30;
async function frenarIntentos(email: string, ip: string | null) {
  await asegurarTablaIntentos();
  const r = await getPool().query(
    "select count(*) filter (where clave = $1)::int as mail, count(*) filter (where clave = $2)::int as ip from login_intentos where at > now() - interval '15 minutes' and clave in ($1, $2)",
    [`mail:${email}`, `ip:${ip ?? "-"}`]
  );
  const { mail, ip: porIp } = r.rows[0] as { mail: number; ip: number };
  if (mail >= MAX_POR_MAIL || (ip && porIp >= MAX_POR_IP)) {
    throw new AuthError("auth/too-many-requests", "Demasiados intentos. Esperá 15 minutos y probá de nuevo (o pedile al administrador el link para cambiar la contraseña).");
  }
}
async function anotarIntento(email: string, ip: string | null) {
  try {
    // De a un comando por consulta (Postgres no acepta dos con parámetros).
    await getPool().query("insert into login_intentos (clave) values ($1), ($2)", [`mail:${email}`, `ip:${ip ?? "-"}`]);
    if (Math.random() < 0.05) await getPool().query("delete from login_intentos where at < now() - interval '1 day'");
  } catch (err) {
    console.warn("[login] no se pudo anotar el intento", err);
  }
}
// Para que tarde lo mismo cuando el mail no existe (no se puede saber qué mails están registrados midiendo el tiempo).
const HASH_FALSO = "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function iniciarSesion(email: string, clave: string, ip: string | null = null): Promise<{ token: string; usuario: Usuario }> {
  const mail = String(email ?? "").trim().toLowerCase();
  await frenarIntentos(mail, ip);
  const u = await porEmail(mail);
  // Mismo mensaje si no existe, si todavía no creó la clave o si está mal (no revela qué mails están registrados).
  const ok = await verificarClave(clave, u?.clave_hash ?? HASH_FALSO);
  if (!u || !u.clave_hash || !ok) {
    await anotarIntento(mail, ip);
    throw new AuthError("auth/invalid-credential", "Mail o contraseña incorrectos. Si todavía no creaste tu contraseña, pedile al administrador el link.");
  }
  if (u.desactivado) throw new AuthError("auth/user-disabled", "Tu usuario está desactivado");
  // Si la clave vino de Firebase, se pasa al formato propio (misma contraseña, sin cerrar sesiones).
  if (u.clave_hash?.startsWith("fbscrypt$")) await getPool().query("update usuarios set clave_hash = $2 where uid = $1", [u.uid, await hashClave(clave)]);
  await getPool().query("update usuarios set ultimo_login = now() where uid = $1", [u.uid]);
  return { token: tokenDeSesion(u), usuario: u };
}

export function tokenDeSesion(u: Pick<Usuario, "uid" | "sesion_ver">): string {
  return firmar({ uid: u.uid, t: "s", v: u.sesion_ver, exp: Date.now() + 30 * 86_400_000 });
}

/** Valida un token de sesión. Devuelve el usuario o null (vencido, revocado o desactivado). */
// La app pregunta cada pocos segundos: el usuario se recuerda 60 s en esta instancia del servidor, así cada
// pedido no va a la base (es lo que más la mantenía despierta). Desactivar o cambiar la clave se nota en ≤ 60 s.
const SESION_TTL = 60_000;
const sesiones = new Map<string, { u: Usuario | null; hasta: number }>();
export function olvidarSesion(uid: string) {
  sesiones.delete(uid);
}

export async function verificarSesion(token: string): Promise<Usuario | null> {
  const p = abrir(token);
  if (!p || p.t !== "s") return null;
  let c = sesiones.get(p.uid);
  // Sin recordar, vencido, o la sesión es de otra versión (cambió la clave en otra instancia): a la base.
  if (!c || c.hasta < Date.now() || c.u?.sesion_ver !== p.v) {
    const fresco = await porUid(p.uid);
    // No se guarda el hash de la contraseña en la memoria del servidor.
    c = { u: fresco ? { ...fresco, clave_hash: null } : null, hasta: Date.now() + SESION_TTL };
    if (sesiones.size > 500) sesiones.clear();
    sesiones.set(p.uid, c);
  }
  const u = c.u;
  if (!u || u.desactivado || u.sesion_ver !== p.v) return null;
  return u;
}

/** El usuario leído recién de la base (para cambiar la contraseña: nada de lo recordado). */
export async function usuarioFresco(uid: string): Promise<Usuario | null> {
  return porUid(uid);
}

export async function cambiarClave(uid: string, nueva: string): Promise<string> {
  validarClave(nueva);
  const hash = await hashClave(nueva);
  const r = await getPool().query(
    "update usuarios set clave_hash = $2, sesion_ver = sesion_ver + 1 where uid = $1 returning uid, sesion_ver",
    [uid, hash]
  );
  if (!r.rowCount) throw new AuthError("auth/user-not-found", "No existe el usuario");
  olvidarSesion(uid);
  return tokenDeSesion(r.rows[0]);
}

export async function linkDeClave(uid: string, base: string): Promise<string> {
  const u = await porUid(uid);
  if (!u) throw new AuthError("auth/user-not-found", "No existe el usuario");
  const token = firmar({ uid, t: "r", v: u.sesion_ver, exp: Date.now() + 3 * 86_400_000, h: huella(u.clave_hash) });
  return `${base.replace(/\/$/, "")}/auth?clave=${encodeURIComponent(token)}`;
}

/** Con el link: pone la contraseña nueva y devuelve una sesión. */
export async function usarLinkDeClave(token: string, nueva: string): Promise<{ token: string; email: string }> {
  const p = abrir(token);
  if (!p || p.t !== "r") throw new AuthError("auth/link-invalido", "El link venció o ya se usó. Pedí uno nuevo.");
  const u = await porUid(p.uid);
  if (!u || u.desactivado || huella(u.clave_hash) !== p.h || u.sesion_ver !== p.v) throw new AuthError("auth/link-invalido", "El link venció o ya se usó. Pedí uno nuevo.");
  return { token: await cambiarClave(u.uid, nueva), email: u.email };
}

export async function cerrarSesiones(uid: string) {
  await getPool().query("update usuarios set sesion_ver = sesion_ver + 1 where uid = $1", [uid]);
  olvidarSesion(uid);
}

/** Lo que usaban las funciones con Firebase Auth (mismos nombres). */
export function adminAuth() {
  return {
    createUser: (d: { email: string; password?: string; displayName?: string }) => crearUsuario(d),
    async getUser(uid: string) {
      const u = await porUid(uid);
      if (!u) throw Object.assign(new Error("No existe el usuario"), { code: "auth/user-not-found" });
      return { uid: u.uid, email: u.email, displayName: u.nombre, disabled: u.desactivado };
    },
    async updateUser(uid: string, d: { email?: string; displayName?: string; disabled?: boolean; password?: string }) {
      if (d.email !== undefined) {
        const email = d.email.trim().toLowerCase();
        if (!emailValido(email)) throw new AuthError("auth/invalid-email", "El mail no es válido");
        const otro = await porEmail(email);
        if (otro && otro.uid !== uid) throw new AuthError("auth/email-already-exists", "Ya existe un usuario con ese mail");
        await getPool().query("update usuarios set email = $2 where uid = $1", [uid, email]);
      }
      if (d.displayName !== undefined) await getPool().query("update usuarios set nombre = $2 where uid = $1", [uid, d.displayName]);
      if (d.disabled !== undefined) await getPool().query("update usuarios set desactivado = $2, sesion_ver = sesion_ver + 1 where uid = $1", [uid, d.disabled]);
      if (d.password) await cambiarClave(uid, d.password);
      olvidarSesion(uid);
    },
    revokeRefreshTokens: (uid: string) => cerrarSesiones(uid),
    async deleteUser(uid: string) {
      const r = await getPool().query("delete from usuarios where uid = $1", [uid]);
      olvidarSesion(uid);
      if (!r.rowCount) throw Object.assign(new Error("No existe el usuario"), { code: "auth/user-not-found" });
      await getPool().query("delete from push_suscripciones where uid = $1", [uid]);
    },
    async generatePasswordResetLink(email: string, opts: { url: string }) {
      const u = await porEmail(email);
      if (!u) throw new AuthError("auth/user-not-found", "No existe el usuario");
      return linkDeClave(u.uid, opts.url.replace(/\/auth\/?$/, ""));
    },
  };
}
