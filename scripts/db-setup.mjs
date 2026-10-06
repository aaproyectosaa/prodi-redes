// Crea (o actualiza) las tablas en Postgres / Neon. Se puede correr las veces que quieras.
// Uso: DATABASE_URL="postgresql://…" npm run db:setup
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (la conexión de Neon).");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: true } });
const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "esquema.sql"), "utf8");
await client.connect();
try {
  await client.query(sql);
  const r = await client.query("select count(*)::int as docs from documentos");
  const u = await client.query("select count(*)::int as usuarios from usuarios");
  console.log(`Listo. Documentos: ${r.rows[0].docs} · Usuarios: ${u.rows[0].usuarios}`);
} finally {
  await client.end();
}
