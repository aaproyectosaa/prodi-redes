// Carga los datos de ejemplo (los mismos de la demo) en una base VACÍA, con usuarios para entrar.
// Sirve para probar el sistema completo de verdad antes de pasar los datos reales.
// Uso: DATABASE_URL="postgresql://…" npm run db:ejemplo            (clave de todos: la que diga CLAVE_EJEMPLO o "prodi2026")
//      agregá --forzar para cargar aunque la base ya tenga datos (pisa los mismos ids).
import { seed } from "../demo/seed";
import { getPool } from "../api/_lib/db";
import { hashClave } from "../api/_lib/cuentas";

async function main() {
  const pool = getPool();
  const { rows } = await pool.query("select count(*)::int as n from documentos");
  if (rows[0].n > 0 && !process.argv.includes("--forzar")) {
    console.error(`La base ya tiene ${rows[0].n} documentos. Para cargar igual: npm run db:ejemplo -- --forzar`);
    process.exit(1);
  }
  const datos = seed() as Record<string, Record<string, Record<string, unknown>>>;
  const cli = await pool.connect();
  let n = 0;
  try {
    await cli.query("begin");
    for (const [coleccion, docs] of Object.entries(datos)) {
      for (const [id, data] of Object.entries(docs)) {
        await cli.query(
          "insert into documentos (coleccion, id, data) values ($1, $2, $3::jsonb) on conflict (coleccion, id) do update set data = excluded.data",
          [coleccion, id, JSON.stringify(data)]
        );
        n++;
      }
    }
    const clave = process.env.CLAVE_EJEMPLO || "prodi2026";
    const hash = await hashClave(clave);
    for (const [uid, p] of Object.entries(datos.profiles ?? {})) {
      const email = String((p as { email?: string }).email ?? "").toLowerCase();
      if (!email) continue;
      await cli.query(
        "insert into usuarios (uid, email, clave_hash, nombre) values ($1, $2, $3, $4) on conflict (uid) do update set email = excluded.email, clave_hash = excluded.clave_hash",
        [uid, email, hash, (p as { nombre?: string }).nombre ?? null]
      );
    }
    await cli.query("commit");
    console.log(`Cargados ${n} documentos y ${Object.keys(datos.profiles ?? {}).length} usuarios (clave: ${clave}).`);
  } catch (err) {
    await cli.query("rollback");
    throw err;
  } finally {
    cli.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
