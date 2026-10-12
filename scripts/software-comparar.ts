// Compara MP Socios con Prodi Software, para apagar MP Socios tranquilos.
//
// SOLO LEE (en las dos bases). Por cada tabla: cuántas filas hay en cada lado, cuáles faltan en Prodi y los
// totales de plata. Al final, lo pagado a cada persona del reparto por bolsa. Si todo coincide: "TODO IGUAL".
// Si MP Socios sigue recibiendo pagos, lo nuevo aparece como "falta en Prodi": se trae corriendo otra vez
// scripts/software-migrar.ts (solo agrega lo que falta).
//
// Uso:
//   pnpm exec tsx --env-file=.env scripts/software-comparar.ts --origen=<ruta al .env.local de MP Socios>

import fs from "fs";
import pg from "pg";

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

const origen = new pg.Pool({ connectionString: urlOrigen, ssl: { rejectUnauthorized: true }, max: 2 });
const destino = new pg.Pool({ connectionString: urlDestino, ssl: local ? undefined : { rejectUnauthorized: true }, max: 2 });

/** Tabla → columnas de plata que se suman. */
const TABLAS: Record<string, string[]> = {
  hub_mp_apps: [],
  hub_partners: ["pct"],
  hub_clients: [],
  hub_client_partner_pct: ["pct"],
  hub_payments: ["amount", "fee"],
  hub_settlements: ["amount_due", "amount_paid"],
  hub_payouts: ["amount"],
  hub_maintenance_clients: ["monthly_amount"],
  hub_maintenance_payments: ["amount"],
  hub_extra_payments: ["amount"],
  hub_expenses: ["amount"],
  hub_subscriptions: ["amount"],
  hub_subscription_charges: ["amount"],
};

/** Clave de cada fila (casi todas tienen id; los % por cliente se identifican por cliente + persona). */
const CLAVE: Record<string, string> = { hub_client_partner_pct: "client_id::text || ':' || partner_id::text" };
const clave = (tabla: string) => CLAVE[tabla] ?? "id::text";

const pesos = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
async function existe(p: pg.Pool, tabla: string) {
  return (await p.query("select 1 from information_schema.tables where table_schema='public' and table_name=$1", [tabla])).rowCount! > 0;
}

console.log(`Prodi: ${local ? "base LOCAL" : "base de producción"} · solo lectura\n`);
let diferencias = 0;
let faltanTotal = 0;

for (const [tabla, plata] of Object.entries(TABLAS)) {
  if (!(await existe(origen, tabla))) continue;
  if (!(await existe(destino, tabla))) {
    console.log(`✗ ${tabla}: no existe en Prodi (falta correr la copia)`);
    diferencias++;
    continue;
  }
  const idsO = new Set((await origen.query(`select ${clave(tabla)} as id from ${tabla}`)).rows.map((r) => r.id as string));
  const idsD = new Set((await destino.query(`select ${clave(tabla)} as id from ${tabla}`)).rows.map((r) => r.id as string));
  const faltan = [...idsO].filter((id) => !idsD.has(id));
  const soloProdi = [...idsD].filter((id) => !idsO.has(id));
  faltanTotal += faltan.length;

  // Totales sobre las filas que están en los dos lados (lo nuevo de un lado no cuenta como diferencia de plata).
  const comunes = [...idsO].filter((id) => idsD.has(id));
  const sumas = async (p: pg.Pool) =>
    plata.length && comunes.length
      ? ((await p.query(`select ${plata.map((c) => `coalesce(sum(${c}),0)::float8 as ${c}`).join(",")} from ${tabla} where ${clave(tabla)} = any($1)`, [comunes])).rows[0] as Record<string, number>)
      : {};
  const [sO, sD] = [await sumas(origen), await sumas(destino)];
  const distintas = plata.filter((c) => Math.abs((sO[c] ?? 0) - (sD[c] ?? 0)) > 0.009);

  const ok = !faltan.length && !distintas.length;
  if (!ok) diferencias++;
  const detalle = plata.map((c) => `${c} ${pesos(sD[c] ?? 0)}${distintas.includes(c) ? ` (MP Socios ${pesos(sO[c] ?? 0)})` : ""}`).join(" · ");
  console.log(
    `${ok ? "✓" : "✗"} ${tabla.padEnd(26)} MP Socios ${String(idsO.size).padStart(5)} · Prodi ${String(idsD.size).padStart(5)}` +
      (faltan.length ? ` · faltan ${faltan.length}` : "") +
      (soloProdi.length ? ` · ${soloProdi.length} cargadas solo en Prodi` : "") +
      (detalle ? `\n    ${detalle}` : "")
  );
}

// Lo pagado a cada persona del reparto, por bolsa (lo que más importa que coincida).
const pagado = async (p: pg.Pool) =>
  (
    await p.query(
      `select pr.name as persona, coalesce(nullif(pay.source,''),'fee') as bolsa, sum(pay.amount)::float8 as total
       from hub_payouts pay join hub_partners pr on pr.id = pay.partner_id group by 1,2 order by 1,2`
    )
  ).rows as Array<{ persona: string; bolsa: string; total: number }>;
if ((await existe(origen, "hub_payouts")) && (await existe(destino, "hub_payouts"))) {
  const [pO, pD] = [await pagado(origen), await pagado(destino)];
  console.log("\nPagado a cada persona (por bolsa):");
  const claves = new Set([...pO, ...pD].map((r) => `${r.persona}|${r.bolsa}`));
  for (const k of claves) {
    const [persona, bolsa] = k.split("|");
    const nombreBolsa = ({ fee: "comisiones", subscription: "planes", maintenance: "mantenimiento", extra: "extras" } as Record<string, string>)[bolsa] ?? bolsa;
    const o = pO.find((r) => r.persona === persona && r.bolsa === bolsa)?.total ?? 0;
    const d = pD.find((r) => r.persona === persona && r.bolsa === bolsa)?.total ?? 0;
    const igual = Math.abs(o - d) < 0.01;
    if (!igual) diferencias++;
    console.log(`  ${igual ? "✓" : "✗"} ${persona.padEnd(8)} ${nombreBolsa.padEnd(13)} Prodi ${pesos(d)}${igual ? "" : ` · MP Socios ${pesos(o)}`}`);
  }
}

console.log(
  diferencias
    ? `\n${diferencias} diferencia(s).${faltanTotal ? ` Faltan ${faltanTotal} fila(s) en Prodi: corré de nuevo la copia (software-migrar.ts --aplicar) y volvé a comparar.` : ""}`
    : "\nTODO IGUAL: Prodi Software tiene lo mismo que MP Socios."
);
await origen.end();
await destino.end();
