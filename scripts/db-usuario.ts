// Crea un usuario de prueba con rol y contraseña, SOLO en una base local (pnpm db:local).
// Uso: pnpm db:usuario pato@prodi.test "Pato" administracion
// La contraseña se genera al azar y se anota en usuarios-locales.txt (ignorado por git), no se imprime.
import fs from "fs";
import { randomBytes } from "crypto";
import { getPool } from "../api/_lib/db";
import { crearUsuario } from "../api/_lib/cuentas";

const ROLES = ["admin", "administracion", "productor", "editor", "pauta", "diseno", "cliente", "pending"];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.error("Solo crea usuarios en una base local (DATABASE_URL a localhost). Para producción usá la app o pnpm db:admin.");
    process.exit(1);
  }
  const [email, nombre, rol = "administracion"] = process.argv.slice(2).filter((a) => a !== "--");
  if (!email || !nombre || !ROLES.includes(rol)) {
    console.error(`Uso: pnpm db:usuario mail@dominio "Nombre" <${ROLES.join("|")}>`);
    process.exit(1);
  }
  const mail = email.trim().toLowerCase();
  const clave = randomBytes(9).toString("base64url");
  const pool = getPool();
  const previo = await pool.query("select uid from usuarios where email = $1", [mail]);
  if (previo.rowCount) {
    console.error(`Ya existe ${mail}.`);
    process.exit(1);
  }
  const { uid } = await crearUsuario({ email: mail, password: clave, displayName: nombre });
  const ahora = new Date().toISOString();
  const perfil = { email: mail, nombre, role: rol, activo: true, avatarColor: "#6F40FC", created_at: ahora, updated_at: ahora };
  await pool.query("insert into documentos (coleccion, id, data) values ('profiles', $1, $2::jsonb)", [uid, JSON.stringify(perfil)]);
  fs.appendFileSync("usuarios-locales.txt", `${mail}\t${clave}\t${rol}\t(base local, ${ahora.slice(0, 10)})\n`);
  console.log(`Listo: ${mail} (${rol}). La contraseña quedó en usuarios-locales.txt.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
