// Antes era Firebase; ahora la base es Postgres (Neon) a través de /api/db y el login es propio (/api/auth).
// Se mantiene este archivo para que el resto de la app siga importando `db` y `auth` de acá.
export { db } from "@/lib/db";
export { auth } from "@/lib/auth";
