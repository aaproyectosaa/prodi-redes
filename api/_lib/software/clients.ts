import { getSql } from "./sql";
import type { MpPayment } from "./mp";

export type HubClient = {
  id: string;
  app_id: string;
  name: string;
  collector_id: string;
  notes: string;
  active: boolean;
  blacklisted: boolean;
  created_at: string;
  updated_at: string;
  payments_count?: number;
  fee_total?: number;
  fee_all?: number;
  amount_total?: number;
  app_name?: string;
  recent?: Array<{
    description: string | null;
    amount: number;
    paid_at: string | null;
  }>;
};

/** Solo ID de vendedor MP (estable). El nombre del producto no define al cliente. */
export function resolveClientRef(payment: {
  collector_id?: string | number | null;
  collector?: { id?: string | number } | null;
  description?: string | null;
  preferredName?: string | null;
}): { key: string; suggestedName: string } | null {
  const raw =
    payment.collector_id != null
      ? String(payment.collector_id)
      : payment.collector?.id != null
        ? String(payment.collector.id)
        : null;

  if (!raw || raw.startsWith("slug:")) return null;

  // Prioridad: nombre de página enviado por la caja → "Producto de X" → Cliente {id}
  let suggestedName = `Cliente ${raw}`;
  const preferred = String(payment.preferredName || "").trim();
  if (preferred.length >= 2) suggestedName = preferred;
  else {
    const fromDesc = sellerNameFromDescription(payment.description);
    if (fromDesc) suggestedName = fromDesc;
  }

  return { key: raw, suggestedName };
}

/**
 * Extrae el nombre de la página/tienda desde la descripción del cobro.
 * Ej: "Producto de Dulce capricho" → "Dulce capricho"
 *     "Cobro Teenager Team" → "Teenager Team"
 * No usa códigos POS (Cobro POS-MSKZGLK8) como nombre de cliente.
 */
export function sellerNameFromDescription(description?: string | null) {
  const d = (description || "").trim();
  if (!d) return null;

  // "Cobro POS-XXXX" / "Cobro POS XXXX" → no es nombre de tienda
  if (/^cobro\s+pos[-_\s]/i.test(d)) return null;

  const patterns = [
    /producto\s+de\s+(.+)/i,
    /pedido\s+(.+?)\s*[-—·]/i,
    /cobro\s+(?:pos\s*[·\-–—:]?\s*)?(.+)/i,
    /^(.+?)\s*[-—]\s*\d+\s*prendas?/i,
  ];
  for (const re of patterns) {
    const m = d.match(re);
    if (!m?.[1]) continue;
    const n = m[1]
      .replace(/\s*[—-].*$/, "")
      .replace(/\s+POS.*$/i, "")
      .trim();
    if (!n || n.length < 2) continue;
    if (isPosLikeLabel(n)) continue;
    if (
      /^(auto|moto|varios|item|producto|pago\s*directo|directo|rapido|rápido)$/i.test(
        n,
      )
    ) {
      continue;
    }
    return n;
  }
  return null;
}

/** Códigos de caja / POS, no nombres de cliente. */
export function isPosLikeLabel(name: string) {
  const t = String(name || "").trim();
  if (!t) return true;
  if (/^pos[-_\s]/i.test(t)) return true;
  // MSKZGLK8, MSMCBS8P, etc.
  if (/^[A-Z0-9]{6,12}$/.test(t)) return true;
  return false;
}

export function slugClientKey(name: string) {
  if (isPosLikeLabel(name)) return null;
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug ? `slug:${slug}` : null;
}

/**
 * Si MP no manda collector_id (pasa en algunos QR), matchea por
 * "Producto de X" contra clientes ya cargados.
 */
export async function matchClientByDescription(
  appId: string,
  description?: string | null,
) {
  const name = sellerNameFromDescription(description);
  if (!name) return null;
  const sql = getSql();

  const exact = await sql`
    SELECT collector_id, name FROM hub_clients
    WHERE app_id = ${appId}
      AND lower(trim(name)) = lower(trim(${name}))
    LIMIT 1
  `;
  if (exact[0]) {
    return {
      key: String(exact[0].collector_id),
      name: String(exact[0].name),
    };
  }

  const fuzzy = await sql`
    SELECT collector_id, name FROM hub_clients
    WHERE app_id = ${appId}
      AND (
        lower(name) LIKE lower(${`%${name}%`})
        OR lower(${name}) LIKE lower('%' || name || '%')
      )
    ORDER BY length(name) ASC
    LIMIT 1
  `;
  if (fuzzy[0]) {
    return {
      key: String(fuzzy[0].collector_id),
      name: String(fuzzy[0].name),
    };
  }
  return null;
}

export async function ensureClient(
  appId: string,
  key: string,
  suggestedName: string,
) {
  const sql = getSql();
  const existing = await sql`
    SELECT id, name FROM hub_clients
    WHERE app_id = ${appId} AND collector_id = ${key}
    LIMIT 1
  `;
  if (existing[0]) {
    const current = String(existing[0].name || "").trim();
    const better = String(suggestedName || "").trim();
    // Si solo tenía placeholder, actualizar al nombre de la página
    if (
      better.length >= 2 &&
      (/^cliente\s+\d+$/i.test(current) ||
        /^sin cliente$/i.test(current) ||
        !current)
    ) {
      await sql`
        UPDATE hub_clients SET name = ${better}, updated_at = NOW()
        WHERE app_id = ${appId} AND collector_id = ${key}
      `;
      return better;
    }
    return current || better;
  }

  await sql`
    INSERT INTO hub_clients (app_id, name, collector_id)
    VALUES (${appId}, ${suggestedName}, ${key})
    ON CONFLICT (app_id, collector_id) DO NOTHING
  `;
  const again = await sql`
    SELECT name FROM hub_clients
    WHERE app_id = ${appId} AND collector_id = ${key}
    LIMIT 1
  `;
  return String(again[0]?.name || suggestedName);
}

export async function ensureClientFromPayment(
  appId: string,
  collectorId: string,
  description?: string | null,
) {
  const ref = resolveClientRef({ collector_id: collectorId, description });
  if (!ref) return null;
  return ensureClient(appId, ref.key, ref.suggestedName);
}

export async function listAllClients(opts?: {
  blacklisted?: boolean;
  q?: string;
  appId?: string;
  from?: string | null;
  to?: string | null;
}) {
  const sql = getSql();
  const bl =
    opts?.blacklisted === true ? "yes" : opts?.blacklisted === false ? "no" : "any";
  const appId = opts?.appId || "";
  const qLike = opts?.q?.trim() ? `%${opts.q.trim()}%` : null;
  const fromDate = opts?.from ? `${opts.from}T00:00:00-03:00` : null;
  const toDate = opts?.to ? `${opts.to}T23:59:59.999-03:00` : null;

  const rows = await sql`
    SELECT
      c.id, c.app_id, c.name, c.collector_id, c.notes, c.active,
      c.blacklisted,
      c.created_at, c.updated_at,
      a.name AS app_name,
      COUNT(p.id) FILTER (
        WHERE p.status = 'approved' AND p.fee > 0
          AND (${fromDate}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) >= ${fromDate}::timestamptz)
          AND (${toDate}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) <= ${toDate}::timestamptz)
      )::int AS payments_count,
      COALESCE(SUM(p.fee) FILTER (
        WHERE p.status = 'approved' AND p.fee > 0
          AND (${fromDate}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) >= ${fromDate}::timestamptz)
          AND (${toDate}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) <= ${toDate}::timestamptz)
      ), 0)::float8 AS fee_total,
      COALESCE(SUM(p.amount) FILTER (
        WHERE p.status = 'approved' AND p.fee > 0
          AND (${fromDate}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) >= ${fromDate}::timestamptz)
          AND (${toDate}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) <= ${toDate}::timestamptz)
      ), 0)::float8 AS amount_total,
      COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee_all
    FROM hub_clients c
    JOIN hub_mp_apps a ON a.id = c.app_id
    LEFT JOIN hub_payments p
      ON p.app_id = c.app_id AND p.collector_id = c.collector_id
    WHERE
      (${bl} = 'any' OR (${bl} = 'yes' AND c.blacklisted = TRUE) OR (${bl} = 'no' AND c.blacklisted = FALSE))
      AND (${appId} = '' OR c.app_id::text = ${appId})
      AND (
        ${qLike}::text IS NULL
        OR c.name ILIKE ${qLike}
        OR c.collector_id ILIKE ${qLike}
        OR a.name ILIKE ${qLike}
        OR COALESCE(c.notes, '') ILIKE ${qLike}
      )
    GROUP BY c.id, a.name
    ORDER BY fee_total DESC, c.name ASC
  `;

  const clients = rows as HubClient[];
  for (const c of clients) {
    const recent = await sql`
      SELECT description, amount::float8 AS amount, paid_at
      FROM hub_payments
      WHERE app_id = ${c.app_id}
        AND collector_id = ${c.collector_id}
        AND status = 'approved'
        AND fee > 0
      ORDER BY COALESCE(paid_at, created_at) DESC
      LIMIT 3
    `;
    c.recent = recent.map((r) => ({
      description: r.description != null ? String(r.description) : null,
      amount: Number(r.amount || 0),
      paid_at: r.paid_at != null ? String(r.paid_at) : null,
    }));
  }
  return clients;
}

function collectorFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.collector_id != null) return String(p.collector_id);
  const col = p.collector as { id?: string | number } | undefined;
  if (col?.id != null) return String(col.id);
  return null;
}

/**
 * Relee raw_json, agrupa por collector_id real de MP
 * y borra clientes viejos tipo slug:moto / slug:auto.
 */
export async function backfillClientsFromPayments() {
  const sql = getSql();
  const rows = await sql`
    SELECT id, app_id, collector_id, description, fee::float8 AS fee, raw_json
    FROM hub_payments
    WHERE fee > 0
  `;

  let linked = 0;
  for (const row of rows) {
    const fromRaw = collectorFromRaw(row.raw_json);
    const current = row.collector_id != null ? String(row.collector_id) : null;
    const description = row.description != null ? String(row.description) : null;
    const realId =
      fromRaw ||
      (current && !current.startsWith("slug:") ? current : null);

    // QR a veces no trae collector_id: matchear por "Producto de X" o crear por nombre de página
    if (!realId) {
      const byName = await matchClientByDescription(
        String(row.app_id),
        description,
      );
      if (byName) {
        await sql`
          UPDATE hub_payments SET
            collector_id = ${byName.key},
            collector_name = ${byName.name},
            updated_at = NOW()
          WHERE id = ${row.id}
        `;
        linked++;
        continue;
      }
      const pageName = sellerNameFromDescription(description);
      if (pageName) {
        const slug = slugClientKey(pageName);
        if (slug) {
          const name = await ensureClient(String(row.app_id), slug, pageName);
          await sql`
            UPDATE hub_payments SET
              collector_id = ${slug},
              collector_name = ${name},
              updated_at = NOW()
            WHERE id = ${row.id}
          `;
          linked++;
        }
      }
      continue;
    }

    const ref = resolveClientRef({
      collector_id: realId,
      description,
    });
    if (!ref) continue;

    const name = await ensureClient(String(row.app_id), ref.key, ref.suggestedName);
    await sql`
      UPDATE hub_payments SET
        collector_id = ${ref.key},
        collector_name = ${name},
        updated_at = NOW()
      WHERE id = ${row.id}
    `;
    linked++;
  }

  // Borrar clientes slug: huérfanos (ya no deberían tener pagos)
  await sql`
    DELETE FROM hub_clients c
    WHERE c.collector_id LIKE 'slug:%'
      AND NOT EXISTS (
        SELECT 1 FROM hub_payments p
        WHERE p.app_id = c.app_id AND p.collector_id = c.collector_id
      )
  `;

  const countRows = await sql`SELECT COUNT(*)::int AS n FROM hub_clients`;
  return {
    paymentsLinked: linked,
    clientsTotal: Number(countRows[0]?.n || 0),
  };
}

export async function listClients(appId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      c.id, c.app_id, c.name, c.collector_id, c.notes, c.active,
      c.created_at, c.updated_at,
      COUNT(p.id) FILTER (WHERE p.status = 'approved')::int AS payments_count,
      COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved'), 0)::float8 AS fee_total,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'approved'), 0)::float8 AS amount_total
    FROM hub_clients c
    LEFT JOIN hub_payments p
      ON p.app_id = c.app_id
      AND p.collector_id = c.collector_id
    WHERE c.app_id = ${appId}
    GROUP BY c.id
    ORDER BY c.name ASC
  `;
  return rows as HubClient[];
}

export async function detectCollectors(appId: string) {
  const sql = getSql();
  return (await sql`
    SELECT
      p.collector_id,
      MAX(p.collector_name) AS collector_name,
      COUNT(*) FILTER (WHERE p.status = 'approved')::int AS payments_count,
      COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved'), 0)::float8 AS fee_total
    FROM hub_payments p
    WHERE p.app_id = ${appId}
      AND p.collector_id IS NOT NULL
      AND p.collector_id <> ''
      AND p.collector_id NOT LIKE 'slug:%'
      AND NOT EXISTS (
        SELECT 1 FROM hub_clients c
        WHERE c.app_id = p.app_id AND c.collector_id = p.collector_id
      )
    GROUP BY p.collector_id
    ORDER BY fee_total DESC
  `) as Array<{
    collector_id: string;
    collector_name: string | null;
    payments_count: number;
    fee_total: number;
  }>;
}

export function clientRefFromMpPayment(
  payment: MpPayment,
  preferredName?: string | null,
) {
  return resolveClientRef({
    collector_id: payment.collector_id,
    collector: payment.collector as { id?: string | number } | undefined,
    description: payment.description,
    preferredName,
  });
}
