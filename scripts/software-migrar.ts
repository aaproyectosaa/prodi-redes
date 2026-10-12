// Pasa los datos de MP Socios (b-socios) a la base de Prodi, para Prodi Software.
//
// SOLO AGREGA: crea las tablas hub_* si faltan, suma las columnas que tenga el origen y copia cada fila con
// "on conflict do nothing" (lo que ya está, no se toca). Nunca borra nada, ni en el origen ni en Prodi.
// Las credenciales de las apps de Mercado Pago se descifran con la clave de MP Socios y se vuelven a cifrar con
// la de Prodi (TOKEN_ENCRYPTION_KEY). Cada integrante del reparto se une a su usuario de Prodi (prodi_uid).
//
// Uso (el .env de MP Socios queda fuera del repo):
//   pnpm exec tsx --env-file=.env.local scripts/software-migrar.ts --origen=<ruta al .env.local de MP Socios>
//   pnpm exec tsx --env-file=.env --env-file=certs/vercel-google.env scripts/software-migrar.ts --origen=… --aplicar --produccion

import fs from "fs";
import crypto from "crypto";
import pg from "pg";
import { crearEsquemaSoftware } from "../api/_lib/software/esquema";
import { encrypt } from "../api/_lib/software/crypto";
import type { Sql } from "../api/_lib/software/sql";

const APLICAR = process.argv.includes("--aplicar");
const PRODUCCION = process.argv.includes("--produccion");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");

const rutaOrigen = arg("origen");
if (!rutaOrigen || !fs.existsSync(rutaOrigen)) {
  console.error("Indicá el .env de MP Socios: --origen=ruta/.env.local");
  process.exit(1);
}
const envOrigen = Object.fromEntries(
  fs
    .readFileSync(rutaOrigen, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const limpiar = (u: string) => u.replace(/([&?])channel_binding=require&?/, "$1").replace(/[?&]$/, "");
const urlOrigen = limpiar(String(envOrigen.DATABASE_URL ?? ""));
const urlDestino = process.env.DATABASE_URL ?? "";
if (!urlOrigen || !urlDestino) throw new Error("Falta DATABASE_URL (origen o destino)");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(urlDestino);
if (APLICAR && !local && !PRODUCCION) {
  console.error("El destino no es local. Para escribir en producción agregá --produccion.");
  process.exit(1);
}

const origen = new pg.Pool({ connectionString: urlOrigen, ssl: { rejectUnauthorized: true }, max: 2 });
const destino = new pg.Pool({ connectionString: urlDestino, ssl: local ? undefined : { rejectUnauthorized: true }, max: 2 });
const sqlDestino: Sql = async (t, ...v) => {
  let q = t[0];
  for (let i = 0; i < v.length; i++) q += `$${i + 1}${t[i + 1]}`;
  return (await destino.query(q, v)).rows;
};

/** Descifra con la clave de MP Socios (mismo formato v1:iv:tag:datos). */
function descifrarViejo(payload: string): string {
  if (!payload || !payload.startsWith("v1:")) return payload ?? "";
  const clave = crypto.createHash("sha256").update(String(envOrigen.ENCRYPTION_KEY || "mp-socios-dev-encryption-key!!")).digest();
  const [, iv, tag, datos] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", clave, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(datos, "base64")), d.final()]).toString("utf8");
}

// En orden, para que las referencias (app_id, partner_id, client_id) ya existan.
const TABLAS = [
  "hub_mp_apps",
  "hub_partners",
  "hub_clients",
  "hub_client_partner_pct",
  "hub_payments",
  "hub_settlements",
  "hub_payouts",
  "hub_activity",
  "hub_maintenance_clients",
  "hub_maintenance_payments",
  "hub_extra_payments",
  "hub_expenses",
  "hub_subscriptions",
  "hub_subscription_charges",
];
const CIFRADOS = ["client_secret", "access_token", "webhook_secret"];
/** Reparto → usuario de Prodi (por nombre del perfil). PRODI es la caja: no tiene usuario. */
const PERSONAS: Record<string, RegExp> = { ARIEL: /^ariel/i, AGUS: /^agust/i, LUCAS: /^lucas/i };

type Col = { column_name: string; data_type: string; udt_name: string };
async function columnas(p: pg.Pool, tabla: string): Promise<Col[]> {
  return (
    await p.query("select column_name, data_type, udt_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [tabla])
  ).rows;
}
const tipoSql = (c: Col) =>
  c.data_type === "USER-DEFINED" ? c.udt_name : c.data_type === "ARRAY" ? `${c.udt_name.replace(/^_/, "")}[]` : c.data_type;

console.log(`Destino: ${local ? "base LOCAL" : "base NO local (producción)"}`);
console.log(APLICAR ? "Copiando (solo agrega)…" : "SIMULACIÓN (no se escribe nada). Para copiar: --aplicar");

if (APLICAR) await crearEsquemaSoftware(sqlDestino);

let total = 0;
for (const tabla of TABLAS) {
  const colsO = await columnas(origen, tabla);
  if (!colsO.length) {
    console.log(`  ${tabla.padEnd(28)} (no existe en el origen)`);
    continue;
  }
  if (APLICAR) {
    // Columnas que tenga el origen y falten en Prodi (las agregaba MP Socios sobre la marcha).
    const colsD = new Set((await columnas(destino, tabla)).map((c) => c.column_name));
    for (const c of colsO) if (!colsD.has(c.column_name)) await destino.query(`alter table ${tabla} add column if not exists "${c.column_name}" ${tipoSql(c)}`);
  }
  const filas = (await origen.query(`select * from ${tabla}`)).rows as Record<string, unknown>[];
  let nuevas = 0;
  for (const f of filas) {
    if (tabla === "hub_mp_apps") for (const k of CIFRADOS) if (typeof f[k] === "string" && f[k]) f[k] = encrypt(descifrarViejo(String(f[k])));
    if (tabla === "hub_partners") {
      const re = PERSONAS[String(f.name ?? "").trim().toUpperCase()];
      if (re) {
        const u = (await destino.query("select id from documentos where coleccion='profiles' and data->>'nombre' ~* $1 and coalesce(data->>'activo','true')<>'false' limit 2", [re.source])).rows;
        if (u.length === 1) f.prodi_uid = u[0].id;
        else console.log(`    ${f.name}: ${u.length ? "más de un usuario parecido" : "sin usuario en Prodi"} (se une a mano)`);
      }
    }
    const claves = Object.keys(f);
    const valores = claves.map((k) => {
      const c = colsO.find((x) => x.column_name === k);
      return c && (c.data_type === "jsonb" || c.data_type === "json") && f[k] !== null ? JSON.stringify(f[k]) : f[k];
    });
    if (!APLICAR) {
      nuevas++;
      continue;
    }
    const r = await destino.query(
      `insert into ${tabla} (${claves.map((k) => `"${k}"`).join(",")}) values (${claves.map((_, i) => `$${i + 1}`).join(",")}) on conflict do nothing`,
      valores
    );
    nuevas += r.rowCount ?? 0;
  }
  total += nuevas;
  console.log(`  ${tabla.padEnd(28)} ${String(filas.length).padStart(5)} en MP Socios · ${APLICAR ? `${nuevas} nuevas` : "se copiarían"}`);
}
await origen.end();
await destino.end();
console.log(APLICAR ? `Listo: ${total} filas nuevas. No se borró ni se pisó nada.` : "Fin de la simulación.");
