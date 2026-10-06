// Carga los datos de ejemplo (los mismos de la demo) en una base VACÍA, con usuarios para entrar.
// Sirve para probar el sistema completo de verdad antes de pasar los datos reales.
// Uso: DATABASE_URL="postgresql://…" pnpm db:ejemplo            (clave de todos: la que diga CLAVE_EJEMPLO o "prodi2026")
//      agregá --forzar para cargar aunque la base ya tenga datos (pisa los mismos ids).
// Nunca corre sobre una base con usuarios reales: para eso está Ajustes → Datos de ejemplo.
import { seed } from "../api/_lib/ejemplo-datos";
import { getPool } from "../api/_lib/db";
import { hashClave } from "../api/_lib/cuentas";

async function main() {
  const pool = getPool();
  const datos = seed() as Record<string, Record<string, Record<string, unknown>>>;
  const uidsEjemplo = Object.keys(datos.profiles ?? {});
  // Usuarios que no son del ejemplo = base real. Ahí la clave conocida sería un agujero.
  const reales = await pool.query("select count(*)::int as n from usuarios where not (uid = any($1::text[]))", [uidsEjemplo]);
  if (reales.rows[0].n > 0) {
    console.error(
      `La base tiene ${reales.rows[0].n} usuarios reales: parece la de producción. db:ejemplo es solo para bases de prueba.\n` +
        "Para ver datos de ejemplo en el sistema real usá Ajustes → Datos de ejemplo."
    );
    process.exit(1);
  }
  const { rows } = await pool.query("select count(*)::int as n from documentos");
  if (rows[0].n > 0 && !process.argv.includes("--forzar")) {
    console.error(`La base ya tiene ${rows[0].n} documentos. Para cargar igual: pnpm db:ejemplo --forzar`);
    process.exit(1);
  }
  const cli = await pool.connect();
  let n = 0;
  let nuevos = 0;
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
      // Una cuenta que ya existe (por uid o por mail) no se toca: nunca se le cambia la clave.
      const r = await cli.query(
        "insert into usuarios (uid, email, clave_hash, nombre) values ($1, $2, $3, $4) on conflict do nothing",
        [uid, email, hash, (p as { nombre?: string }).nombre ?? null]
      );
      nuevos += r.rowCount ?? 0;
    }
    await cli.query("commit");
    console.log(`Cargados ${n} documentos y ${nuevos} usuarios nuevos (clave: ${clave}).`);
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
