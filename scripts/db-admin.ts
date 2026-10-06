// Crea (o vuelve a habilitar) un administrador y muestra el link para que ponga su contraseña.
// Sirve para arrancar con una base vacía: sin esto nadie puede dar roles.
// Uso: DATABASE_URL="postgresql://…" AUTH_SECRET=… APP_URL=https://… pnpm db:admin lucas@somosprodi.com "Lucas Paulón"
import { getPool } from "../api/_lib/db";
import { crearUsuario, linkDeClave } from "../api/_lib/cuentas";

async function main() {
  const [email, ...resto] = process.argv.slice(2).filter((a) => a !== "--");
  const nombre = resto.join(" ").trim() || null;
  if (!email) {
    console.error('Uso: pnpm db:admin mail@dominio.com "Nombre y apellido"');
    process.exit(1);
  }
  if (!process.env.AUTH_SECRET) {
    console.error("Falta AUTH_SECRET (el mismo que en Vercel), si no el link no sirve.");
    process.exit(1);
  }
  const pool = getPool();
  const mail = email.trim().toLowerCase();
  const previo = await pool.query("select uid from usuarios where email = $1", [mail]);
  const uid = previo.rows[0]?.uid ?? (await crearUsuario({ email: mail, displayName: nombre })).uid;
  if (previo.rowCount) await pool.query("update usuarios set desactivado = false where uid = $1", [uid]);

  const ahora = new Date().toISOString();
  const actual = await pool.query("select data from documentos where coleccion = 'profiles' and id = $1", [uid]);
  const perfil = {
    ...(actual.rows[0]?.data ?? { created_at: ahora, avatarColor: "#6F40FC" }),
    email: mail,
    nombre: nombre ?? actual.rows[0]?.data?.nombre ?? mail.split("@")[0],
    role: "admin",
    updated_at: ahora,
  };
  await pool.query(
    "insert into documentos (coleccion, id, data) values ('profiles', $1, $2::jsonb) on conflict (coleccion, id) do update set data = excluded.data",
    [uid, JSON.stringify(perfil)]
  );
  const base = process.env.APP_URL || "http://localhost:3001";
  console.log(`Listo: ${mail} es administrador.`);
  console.log(`Link para poner la contraseña (vence en 3 días, sirve una vez):\n${await linkDeClave(uid, base)}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
