// Trae de Firebase a Postgres todas las colecciones de Firestore (con sus subcolecciones, como los
// mensajes de cada chat) y los usuarios de Firebase Auth con sus contraseñas.
//
// SOLO AGREGA: lo que ya existe en la base nueva (mismo id, o un usuario con el mismo mail) NO se toca;
// se informa como "ya estaba". Nunca borra nada, ni en Firebase ni en Postgres.
//
// Se unifican dos proyectos en Prodi: "progreso" y "postgo". Cada documento nuevo queda marcado con
// _origen (de qué proyecto vino). Si los dos tienen el mismo id, queda el primero que se cargó.
//
// Uso (llaves en certs/, que no se sube a git):
//   pnpm migrar:firebase --origen=progreso                          → simula contra la base de .env.local
//   pnpm migrar:firebase --origen=progreso --aplicar                → agrega en la base local
//   pnpm migrar:firebase --origen=postgo --aplicar --produccion     → agrega en una base que no es local
// La llave: --llave=ruta.json, o certs/firebase-<origen>.json, o GOOGLE_APPLICATION_CREDENTIALS.
// Antes: pnpm db:setup (crea las tablas).

import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from "firebase-admin/firestore";
import pg from "pg";

import fsArch from "fs";
const APLICAR = process.argv.includes("--aplicar");
const PRODUCCION = process.argv.includes("--produccion");
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const ORIGEN = arg("origen");
if (!ORIGEN || !/^[a-z0-9-]+$/.test(ORIGEN)) {
  console.error("Indicá de qué proyecto se trae: --origen=progreso o --origen=postgo");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (la conexión de Neon).");
  process.exit(1);
}

const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
const LLAVE = arg("llave") ?? `certs/firebase-${ORIGEN}.json`;
if (arg("llave") && !fsArch.existsSync(LLAVE)) {
  console.error(`No encontré la llave ${LLAVE}`);
  process.exit(1);
}
// Primero la llave del origen (certs/); la variable en base64 solo si es una llave de verdad (no "COMPLETAR").
const desdeB64 = () => {
  try {
    const j = JSON.parse(Buffer.from(b64 ?? "", "base64").toString("utf8"));
    return j?.private_key ? j : null;
  } catch {
    return null;
  }
};
const credencial = fsArch.existsSync(LLAVE)
  ? cert(JSON.parse(fsArch.readFileSync(LLAVE, "utf8")))
  : desdeB64()
    ? cert(desdeB64())
    : applicationDefault();
initializeApp({ credential: credencial });
const fs = getFirestore();
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
if (APLICAR && !local && !PRODUCCION) {
  console.error("La base no es local. Para escribir en producción agregá --produccion (solo agrega, no pisa).");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: true }, max: 3 });

/** Tipos de Firestore → JSON (fechas como texto ISO, igual que usa la app). */
function aJson(v) {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof GeoPoint) return { lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return v.path;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  if (Array.isArray(v)) return v.map(aJson);
  if (typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = aJson(x);
    return o;
  }
  return v;
}

let lote = [];
let total = 0;
const porColeccion = {};
const nuevosPor = {};
const yaEstabanPor = {};
const base = (path) => path.split("/").filter((_, i) => i % 2 === 0).join("/");
const clave = (c, id) => c + "\u0000" + id;

async function volcar() {
  if (!lote.length) return;
  // Qué ya existe en la base nueva (eso no se toca).
  const { rows } = await pool.query(
    "select coleccion, id from documentos where (coleccion, id) in (select * from unnest($1::text[], $2::text[]))",
    [lote.map((d) => d.coleccion), lote.map((d) => d.id)]
  );
  const existentes = new Set(rows.map((r) => clave(r.coleccion, r.id)));
  const nuevos = [];
  for (const d of lote) {
    const b = base(d.coleccion);
    if (existentes.has(clave(d.coleccion, d.id))) yaEstabanPor[b] = (yaEstabanPor[b] ?? 0) + 1;
    else {
      nuevosPor[b] = (nuevosPor[b] ?? 0) + 1;
      nuevos.push(d);
    }
  }
  if (APLICAR && nuevos.length) {
    const vals = [];
    const params = [];
    nuevos.forEach((d, i) => {
      vals.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}::jsonb)`);
      params.push(d.coleccion, d.id, JSON.stringify(d.data));
    });
    // "do nothing": si apareció entre la consulta y la escritura, tampoco se pisa.
    await pool.query(`insert into documentos (coleccion, id, data) values ${vals.join(",")} on conflict (coleccion, id) do nothing`, params);
  }
  lote = [];
}

async function copiarColeccion(ref) {
  const nombreBase = ref.path.split("/").filter((_, i) => i % 2 === 0).join("/");
  let ultimo = null;
  for (;;) {
    let q = ref.orderBy("__name__").limit(400);
    if (ultimo) q = q.startAfter(ultimo);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      lote.push({ coleccion: ref.path, id: d.id, data: { ...aJson(d.data()), _origen: ORIGEN } });
      total++;
      porColeccion[nombreBase] = (porColeccion[nombreBase] ?? 0) + 1;
      if (lote.length >= 200) await volcar();
      for (const sub of await d.ref.listCollections()) await copiarColeccion(sub);
    }
    ultimo = snap.docs[snap.docs.length - 1];
    process.stdout.write(`\r${total} documentos…`);
  }
}

async function copiarUsuarios() {
  let token;
  let n = 0;
  let conClave = 0;
  let nuevos = 0;
  let yaEstaban = 0;
  const otroUid = [];
  do {
    const r = await getAuth().listUsers(1000, token);
    for (const u of r.users) {
      if (!u.email) continue;
      // Contraseña de Firebase: se guarda tal cual y se valida con FIREBASE_HASH_* (ver docs/DESPLIEGUE.md).
      const hash = u.passwordHash && u.passwordSalt ? `fbscrypt$${u.passwordSalt}$${u.passwordHash}` : null;
      if (hash) conClave++;
      n++;
      const mail = u.email.toLowerCase();
      const ya = (await pool.query("select uid from usuarios where uid = $1 or email = $2", [u.uid, mail])).rows;
      if (ya.length) {
        yaEstaban++;
        // Misma persona con otro usuario en el sistema nuevo: sus datos viejos apuntan al uid viejo.
        if (!ya.some((r) => r.uid === u.uid)) otroUid.push(`${mail} (viejo ${u.uid} → nuevo ${ya[0].uid})`);
        continue;
      }
      nuevos++;
      if (APLICAR) {
        await pool.query(
          "insert into usuarios (uid, email, clave_hash, nombre, desactivado) values ($1, $2, $3, $4, $5) on conflict do nothing",
          [u.uid, mail, hash, u.displayName ?? null, u.disabled]
        );
      }
    }
    token = r.pageToken;
  } while (token);
  return { n, conClave, nuevos, yaEstaban, otroUid };
}

console.log(`Origen: Firebase "${ORIGEN}" (proyecto ${JSON.parse(fsArch.existsSync(LLAVE) ? fsArch.readFileSync(LLAVE, "utf8") : "{}").project_id ?? "?"})`);
console.log(`Destino: ${local ? "base LOCAL" : "base NO local (producción)"}`);
console.log(APLICAR ? "Agregando de Firebase a Postgres (lo que ya existe no se toca)…" : "SIMULACIÓN (no se escribe nada). Para agregar: --aplicar");
for (const col of await fs.listCollections()) await copiarColeccion(col);
await volcar();
console.log(`\nDocumentos: ${total}`);
console.log(`  ${"colección".padEnd(28)} ${"en Firebase".padStart(11)} ${"nuevos".padStart(8)} ${"ya estaban".padStart(10)}`);
for (const [c, n] of Object.entries(porColeccion).sort((a, b) => b[1] - a[1]))
  console.log(`  ${c.padEnd(28)} ${String(n).padStart(11)} ${String(nuevosPor[c] ?? 0).padStart(8)} ${String(yaEstabanPor[c] ?? 0).padStart(10)}`);
const u = await copiarUsuarios();
console.log(`Usuarios: ${u.n} en Firebase · ${u.nuevos} nuevos · ${u.yaEstaban} ya estaban (${u.conClave} con contraseña de Firebase)`);
if (u.otroUid.length) {
  console.log("Ojo: estas personas ya existen en el sistema nuevo con OTRO usuario (sus datos viejos quedan con el usuario viejo; hay que unirlos):");
  for (const x of u.otroUid) console.log("  - " + x);
}
if (!u.conClave && u.n) console.log("Ojo: la service account no trajo las contraseñas. Dale el rol 'Firebase Authentication Admin' o generá links desde Equipo.");
await pool.end();
console.log(APLICAR ? "Listo: se agregó lo nuevo, no se modificó nada que ya existía." : "Fin de la simulación: no se escribió nada.");
