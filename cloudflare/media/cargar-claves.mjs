// Carga en el puente de Cloudflare las dos claves que salen de AUTH_SECRET (.env de producción).
// Uso (desde la carpeta del proyecto): node cloudflare/media/cargar-claves.mjs
// Usa la sesión de wrangler (wrangler login): primero la renueva con "whoami" y después llama a la API de Cloudflare.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const CUENTA = "e2ee4be572b11b1ead9bcbf5285980e8";
const WORKER = "prodi-media";
const aca = dirname(fileURLToPath(import.meta.url));

const env = readFileSync(join(aca, "..", "..", ".env"), "utf8");
const linea = env.split(/\r?\n/).find((l) => l.startsWith("AUTH_SECRET="));
if (!linea) throw new Error("No encontré AUTH_SECRET en .env");
const secreto = linea.slice("AUTH_SECRET=".length).trim().replace(/^"|"$/g, "");

// Renueva la sesión de wrangler si venció.
execSync("pnpm dlx wrangler@4 whoami", { cwd: aca, stdio: "inherit" });

const candidatos = [
  process.env.APPDATA && join(process.env.APPDATA, "xdg.config", ".wrangler", "config", "default.toml"),
  join(homedir(), ".wrangler", "config", "default.toml"),
  join(homedir(), ".config", ".wrangler", "config", "default.toml"),
].filter(Boolean);
let token = null;
for (const p of candidatos) {
  try {
    const m = readFileSync(p, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
    if (m) {
      token = m[1];
      break;
    }
  } catch {
    /* sigue con el próximo */
  }
}
if (!token) throw new Error("No encontré la sesión de wrangler. Corré: pnpm dlx wrangler@4 login");

for (const [nombre, uso] of [
  ["MEDIA_KEY", "prodi:media-token:v1"],
  ["WORKER_KEY", "prodi:media-worker:v1"],
]) {
  const valor = createHmac("sha256", secreto).update(uso).digest("base64url");
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CUENTA}/workers/scripts/${WORKER}/secrets`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: nombre, text: valor, type: "secret_text" }),
  });
  const d = await r.json();
  if (!d.success) throw new Error(`${nombre}: ${JSON.stringify(d.errors)}`);
  console.log(`${nombre} cargada ✓`);
}
console.log("\nListo: las dos claves quedaron cargadas.");
