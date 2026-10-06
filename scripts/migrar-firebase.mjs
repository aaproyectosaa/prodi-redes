// Pasa TODO de Firebase a Postgres (Neon): todas las colecciones de Firestore (con sus
// subcolecciones, como los mensajes de cada chat) y los usuarios de Firebase Auth con sus
// contraseñas (siguen entrando con la misma clave).
//
// Uso (una sola vez, con la service account de Firebase):
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json DATABASE_URL="postgresql://…" npm run migrar:firebase            → simula y cuenta
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json DATABASE_URL="postgresql://…" npm run migrar:firebase -- --aplicar → copia
//
// Se puede correr más de una vez: pisa los documentos con el mismo id (no duplica).
// Antes: npm run db:setup (crea las tablas).

import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from "firebase-admin/firestore";
import pg from "pg";

const APLICAR = process.argv.includes("--aplicar");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (la conexión de Neon).");
  process.exit(1);
}

const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
initializeApp({ credential: b64 ? cert(JSON.parse(Buffer.from(b64, "base64").toString("utf8"))) : applicationDefault() });
const fs = getFirestore();
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
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

async function volcar() {
  if (!lote.length) return;
  if (APLICAR) {
    const vals = [];
    const params = [];
    lote.forEach((d, i) => {
      vals.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}::jsonb)`);
      params.push(d.coleccion, d.id, JSON.stringify(d.data));
    });
    await pool.query(
      `insert into documentos (coleccion, id, data) values ${vals.join(",")} on conflict (coleccion, id) do update set data = excluded.data`,
      params
    );
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
      lote.push({ coleccion: ref.path, id: d.id, data: aJson(d.data()) });
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
  do {
    const r = await getAuth().listUsers(1000, token);
    for (const u of r.users) {
      if (!u.email) continue;
      // Contraseña de Firebase: se guarda tal cual y se valida con FIREBASE_HASH_* (ver docs/DESPLIEGUE.md).
      const hash = u.passwordHash && u.passwordSalt ? `fbscrypt$${u.passwordSalt}$${u.passwordHash}` : null;
      if (hash) conClave++;
      if (APLICAR) {
        await pool.query(
          `insert into usuarios (uid, email, clave_hash, nombre, desactivado) values ($1, $2, $3, $4, $5)
           on conflict (uid) do update set email = excluded.email, nombre = excluded.nombre, desactivado = excluded.desactivado,
             clave_hash = coalesce(usuarios.clave_hash, excluded.clave_hash)`,
          [u.uid, u.email.toLowerCase(), hash, u.displayName ?? null, u.disabled]
        );
      }
      n++;
    }
    token = r.pageToken;
  } while (token);
  return { n, conClave };
}

console.log(APLICAR ? "Copiando de Firebase a Postgres…" : "SIMULACIÓN (no se escribe nada). Para copiar: --aplicar");
for (const col of await fs.listCollections()) await copiarColeccion(col);
await volcar();
console.log(`\nDocumentos: ${total}`);
for (const [c, n] of Object.entries(porColeccion).sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(28)} ${n}`);
const u = await copiarUsuarios();
console.log(`Usuarios: ${u.n} (${u.conClave} con contraseña de Firebase${u.conClave < u.n ? "; los demás entran con el link que genera el admin en Equipo" : ""})`);
if (!u.conClave && u.n) console.log("Ojo: la service account no trajo las contraseñas. Dale el rol 'Firebase Authentication Admin' o generá links desde Equipo.");
await pool.end();
console.log(APLICAR ? "Listo." : "Fin de la simulación.");
