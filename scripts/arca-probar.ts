// Prueba la conexión con ARCA: estado de sus servidores y último número de factura del punto de venta.
// Uso: pnpm arca:probar   (lee .env y .env.local: ARCA_* y DATABASE_URL, donde guarda el ticket de acceso)
// El ticket se guarda en la base a propósito: ARCA no da otro mientras el anterior (12 h) siga vigente,
// así que la app y este script tienen que compartirlo.
import { estadoArca } from "../api/_lib/arca";
import { getPool } from "../api/_lib/db";

estadoArca()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPool().end();
    } catch {
      // sin base no hay nada que cerrar
    }
  });
