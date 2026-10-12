import { getSql } from "./sql";

export type ActivityType =
  | "sync"
  | "ingest"
  | "subscription"
  | "payout"
  | "payout_undo"
  | "client_blacklist"
  | "client_restore"
  | "client_rename"
  | "partner_update"
  | "client_pct"
  | "app_save"
  | "cleanup"
  | "maintenance"
  | "extra"
  | "expense";

export async function logActivity(
  type: ActivityType,
  message: string,
  meta?: Record<string, unknown>,
) {
  try {
    const sql = getSql();
    const metaJson = JSON.stringify(meta || {});
    await sql`
      INSERT INTO hub_activity (type, message, meta)
      VALUES (${type}, ${message}, ${metaJson}::jsonb)
    `;
  } catch (e) {
    console.error("activity log failed", e);
  }
}

export async function listActivity(limit = 100) {
  const sql = getSql();
  return sql`
    SELECT id, type, message, meta, created_at
    FROM hub_activity
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}
