// Puente de videos y fotos de Drive en Cloudflare (no cobra por la transferencia, Vercel sí).
// Hace lo mismo que /api/drive/media: valida el permiso firmado de 1 hora (media-token) y pasa el archivo desde Drive
// con soporte Range. El token de Drive lo pide a Prodi (/api/drive/worker-token) y lo guarda mientras vale.
//
// Secretos (wrangler secret put): MEDIA_KEY (clave del media-token, base64url) y WORKER_KEY (para pedir el token de Drive).
// Variable: PRODI_URL (https://prodi-redes.vercel.app).

const TIPO_SEGURO = /^(video\/[a-z0-9.+-]+|image\/(png|jpeg|webp|gif|avif))$/;
const PASAN = ["content-length", "content-range", "accept-ranges"];

let tokenDrive = null; // { token, hasta }

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const desdeB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function cors(h = new Headers()) {
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Headers", "Range");
  h.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  return h;
}

function error(status, msg) {
  const h = cors(new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" }));
  return new Response(JSON.stringify({ error: msg }), { status, headers: h });
}

/** Mismo formato que api/_lib/media-token.ts: base64url("m1.<fileId>.<vence>").<hmac de "media:<data>"> */
async function tokenValido(env, token, fileId) {
  const [data, sig] = String(token || "").split(".");
  if (!data || !sig) return false;
  const clave = await crypto.subtle.importKey("raw", desdeB64url(env.MEDIA_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let firma;
  try {
    firma = desdeB64url(sig);
  } catch {
    return false;
  }
  if (!(await crypto.subtle.verify("HMAC", clave, firma, new TextEncoder().encode(`media:${data}`)))) return false;
  const [v, id, vence] = new TextDecoder().decode(desdeB64url(data)).split(".");
  return v === "m1" && id === fileId && Number(vence) * 1000 > Date.now();
}

async function accessToken(env, forzar = false) {
  if (!forzar && tokenDrive && tokenDrive.hasta > Date.now()) return tokenDrive.token;
  const r = await fetch(`${env.PRODI_URL}/api/drive/worker-token`, { method: "POST", headers: { "x-worker-key": env.WORKER_KEY } });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const d = await r.json();
  tokenDrive = { token: d.accessToken, hasta: Date.now() + Math.max(60, (d.expiresIn || 600) - 300) * 1000 };
  return tokenDrive.token;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (req.method !== "GET" && req.method !== "HEAD") return error(405, "Method not allowed");
    const u = new URL(req.url);
    const fileId = u.searchParams.get("fileId") || "";
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return error(400, "fileId required");
    if (!(await tokenValido(env, u.searchParams.get("token"), fileId))) return error(403, "Link inválido o vencido. Volvé a abrirlo.");

    const pedir = async (forzar) => {
      const h = { Authorization: `Bearer ${await accessToken(env, forzar)}` };
      const range = req.headers.get("Range");
      if (range) h.Range = range;
      return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: h });
    };
    let drive;
    try {
      drive = await pedir(false);
      // Token vencido o revocado: se pide otro una vez.
      if (drive.status === 401) drive = await pedir(true);
    } catch {
      return error(502, "No se pudo conectar con Drive");
    }
    if (!drive.ok) {
      drive.body?.cancel();
      return error(drive.status, `Drive respondió ${drive.status}`);
    }

    const h = cors(new Headers());
    for (const k of PASAN) {
      const v = drive.headers.get(k);
      if (v) h.set(k, v);
    }
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Content-Security-Policy", "sandbox; default-src 'none'");
    h.set("Cache-Control", "private, max-age=3000");
    const tipo = (drive.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (TIPO_SEGURO.test(tipo)) h.set("Content-Type", tipo);
    else {
      h.set("Content-Type", "application/octet-stream");
      h.set("Content-Disposition", "attachment");
    }
    if (u.searchParams.get("descarga") === "1") {
      const nombre = (u.searchParams.get("nombre") || "archivo").replace(/[\r\n"\\/]/g, "").slice(0, 150) || "archivo";
      const ascii = nombre.normalize("NFD").replace(/[^\x20-\x7e]/g, "") || "archivo";
      h.set("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`);
    }
    return new Response(req.method === "HEAD" ? null : drive.body, { status: drive.status, headers: h });
  },
};
