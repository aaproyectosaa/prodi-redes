import { NextRequest, NextResponse } from "../next-shim";
import { logActivity } from "../activity";
import { getAppById } from "../apps";
import { decrypt } from "../crypto";
import { requireSession, unauthorized } from "../next-shim";
import { getSql } from "../sql";
import { clampMpFeePct } from "../money";
import {
  ensureSubscriptionTables,
  parseHubStatus,
  resetChargeMpFeeAuto,
  setChargeMpNetAmount,
  setChargesMpFeePct,
  setSubscriptionHubStatus,
  syncAuthorizedPaymentsForPreapproval,
  notifyUnsentChargesForSubscription,
  notifyUnsentAcceptedCharges,
} from "../subscriptions";

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();

  try {
    await ensureSubscriptionTables();
    void notifyUnsentAcceptedCharges().catch((e) =>
      console.warn("[subscriptions] mail backfill", e),
    );
    const sp = req.nextUrl.searchParams;
    const appId = sp.get("appId") || "";
    const clientId = sp.get("clientId") || "";
    const collectorId = sp.get("collectorId") || "";
    const status = sp.get("status") || "";
    const kind = sp.get("kind") || "";
    const hubStatus = sp.get("hubStatus") || "";
    const q = sp.get("q") || "";
    const fromRaw = sp.get("from") || "";
    const toRaw = sp.get("to") || "";
    const fromDate = fromRaw ? `${fromRaw}T00:00:00-03:00` : null;
    const toDate = toRaw ? `${toRaw}T23:59:59.999-03:00` : null;
    const qLike = q ? `%${q}%` : null;
    const missingFee = sp.get("missingFee") === "1" ? "1" : "";
    const mpStatus = sp.get("mpStatus") || "";
    const limit = Math.min(Math.max(Number(sp.get("limit") || 50), 1), 100);
    const page = Math.max(Number(sp.get("page") || 1), 1);
    const offset = (page - 1) * limit;

    const sql = getSql();

    let filterCollector = collectorId;
    if (clientId) {
      const c = await sql`
        SELECT collector_id FROM hub_clients WHERE id = ${clientId} LIMIT 1
      `;
      filterCollector = String(c[0]?.collector_id || filterCollector || "");
    }

    const charges = await sql`
      SELECT
        c.id, c.app_id, c.subscription_id, c.charge_uid,
        c.mp_payment_id, c.mp_authorized_payment_id, c.mp_preapproval_id,
        c.status, c.amount::float8 AS amount, c.currency, c.kind,
        COALESCE(c.mp_fee_pct, 0)::float8 AS mp_fee_pct,
        c.mp_net_amount::float8 AS mp_net_amount,
        COALESCE(c.mp_fee_manual, FALSE) AS mp_fee_manual,
        CASE
          WHEN c.mp_net_amount IS NOT NULL THEN c.mp_net_amount
          ELSE ROUND((c.amount * (1 - COALESCE(c.mp_fee_pct, 0) / 100.0))::numeric, 2)
        END::float8 AS net_amount,
        c.collector_id, c.collector_name, c.payer_email, c.description,
        c.external_reference, c.paid_at, c.created_at,
        a.name AS app_name,
        cl.name AS client_name,
        cl.id AS client_id
      FROM hub_subscription_charges c
      JOIN hub_mp_apps a ON a.id = c.app_id
      LEFT JOIN hub_clients cl
        ON cl.app_id = c.app_id AND cl.collector_id = c.collector_id
      LEFT JOIN hub_subscriptions hs ON hs.id = c.subscription_id
      WHERE
        (${appId} = '' OR c.app_id::text = ${appId})
        AND (${status} = '' OR c.status = ${status})
        AND (${kind} = '' OR c.kind = ${kind})
        AND (${filterCollector} = '' OR c.collector_id = ${filterCollector})
        AND (
          ${filterCollector} <> ''
          OR COALESCE(cl.blacklisted, FALSE) = FALSE
        )
        AND (
          ${fromDate}::timestamptz IS NULL
          OR COALESCE(c.paid_at, c.created_at) >= ${fromDate}::timestamptz
        )
        AND (
          ${toDate}::timestamptz IS NULL
          OR COALESCE(c.paid_at, c.created_at) <= ${toDate}::timestamptz
        )
        AND (
          ${qLike}::text IS NULL
          OR COALESCE(c.description, '') ILIKE ${qLike}
          OR COALESCE(c.payer_email, '') ILIKE ${qLike}
          OR COALESCE(c.mp_payment_id, '') ILIKE ${qLike}
          OR COALESCE(c.mp_preapproval_id, '') ILIKE ${qLike}
          OR COALESCE(a.name, '') ILIKE ${qLike}
          OR COALESCE(cl.name, '') ILIKE ${qLike}
          OR COALESCE(c.collector_name, '') ILIKE ${qLike}
        )
        AND COALESCE(c.hidden, FALSE) = FALSE
        AND (
          ${missingFee} <> '1'
          OR (
            c.status = 'approved'
            AND COALESCE(c.mp_fee_pct, 0) = 0
            AND c.mp_net_amount IS NULL
          )
        )
        AND (
          CASE
            WHEN c.mp_preapproval_id IS NOT NULL AND c.mp_preapproval_id <> '' THEN
              COALESCE(hs.hub_status, 'pending')
            ELSE
              COALESCE(hs.hub_status, 'accepted')
          END
        ) = 'accepted'
      ORDER BY COALESCE(c.paid_at, c.created_at) DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totals = await sql`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(c.amount), 0)::float8 AS amount,
        COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'approved'), 0)::float8 AS approved_amount_gross,
        COALESCE(SUM(
          CASE
            WHEN c.mp_net_amount IS NOT NULL THEN c.mp_net_amount
            ELSE ROUND((c.amount * (1 - COALESCE(c.mp_fee_pct, 0) / 100.0))::numeric, 2)
          END
        ) FILTER (WHERE c.status = 'approved'), 0)::float8 AS approved_amount,
        COUNT(*) FILTER (WHERE c.status = 'approved')::int AS approved_count
      FROM hub_subscription_charges c
      JOIN hub_mp_apps a ON a.id = c.app_id
      LEFT JOIN hub_clients cl
        ON cl.app_id = c.app_id AND cl.collector_id = c.collector_id
      LEFT JOIN hub_subscriptions hs ON hs.id = c.subscription_id
      WHERE
        (${appId} = '' OR c.app_id::text = ${appId})
        AND (${status} = '' OR c.status = ${status})
        AND (${kind} = '' OR c.kind = ${kind})
        AND (${filterCollector} = '' OR c.collector_id = ${filterCollector})
        AND (
          ${filterCollector} <> ''
          OR COALESCE(cl.blacklisted, FALSE) = FALSE
        )
        AND (
          ${fromDate}::timestamptz IS NULL
          OR COALESCE(c.paid_at, c.created_at) >= ${fromDate}::timestamptz
        )
        AND (
          ${toDate}::timestamptz IS NULL
          OR COALESCE(c.paid_at, c.created_at) <= ${toDate}::timestamptz
        )
        AND (
          ${qLike}::text IS NULL
          OR COALESCE(c.description, '') ILIKE ${qLike}
          OR COALESCE(c.payer_email, '') ILIKE ${qLike}
          OR COALESCE(c.mp_payment_id, '') ILIKE ${qLike}
          OR COALESCE(c.mp_preapproval_id, '') ILIKE ${qLike}
          OR COALESCE(a.name, '') ILIKE ${qLike}
          OR COALESCE(cl.name, '') ILIKE ${qLike}
          OR COALESCE(c.collector_name, '') ILIKE ${qLike}
        )
        AND COALESCE(c.hidden, FALSE) = FALSE
        AND (
          ${missingFee} <> '1'
          OR (
            c.status = 'approved'
            AND COALESCE(c.mp_fee_pct, 0) = 0
            AND c.mp_net_amount IS NULL
          )
        )
        AND (
          CASE
            WHEN c.mp_preapproval_id IS NOT NULL AND c.mp_preapproval_id <> '' THEN
              COALESCE(hs.hub_status, 'pending')
            ELSE
              COALESCE(hs.hub_status, 'accepted')
          END
        ) = 'accepted'
    `;

    const subscriptions = await sql`
      SELECT
        s.id, s.app_id, s.mp_preapproval_id, s.status,
        COALESCE(s.hub_status, 'accepted') AS hub_status,
        s.reason, s.payer_email AS stored_payer_email,
        s.collector_id, s.collector_name, s.amount::float8 AS amount, s.currency,
        s.frequency, s.frequency_type, s.next_payment_date, s.start_date,
        s.external_reference, s.created_at, s.updated_at,
        a.name AS app_name,
        cl.name AS client_name,
        cl.id AS client_id,
        last.charge_status AS last_charge_status,
        last.charge_paid_at AS last_charge_paid_at,
        last.charge_amount::float8 AS last_charge_amount,
        COALESCE(NULLIF(s.payer_email, ''), last.charge_payer_email) AS payer_email,
        COALESCE(pay.ever_paid, FALSE) AS ever_paid
      FROM hub_subscriptions s
      JOIN hub_mp_apps a ON a.id = s.app_id
      LEFT JOIN hub_clients cl
        ON cl.app_id = s.app_id AND cl.collector_id = s.collector_id
      LEFT JOIN LATERAL (
        SELECT c.status AS charge_status, c.paid_at AS charge_paid_at, c.amount AS charge_amount,
          c.payer_email AS charge_payer_email
        FROM hub_subscription_charges c
        WHERE COALESCE(c.hidden, FALSE) = FALSE
          AND (
            c.subscription_id = s.id
            OR (
              s.mp_preapproval_id IS NOT NULL AND s.mp_preapproval_id <> ''
              AND c.mp_preapproval_id = s.mp_preapproval_id
            )
            OR (
              s.external_reference IS NOT NULL AND s.external_reference <> ''
              AND c.external_reference = s.external_reference
            )
          )
        ORDER BY COALESCE(c.paid_at, c.created_at) DESC
        LIMIT 1
      ) last ON TRUE
      LEFT JOIN LATERAL (
        SELECT bool_or(c.status IN ('approved', 'authorized') AND c.amount > 0) AS ever_paid
        FROM hub_subscription_charges c
        WHERE COALESCE(c.hidden, FALSE) = FALSE
          AND (
            c.subscription_id = s.id
            OR (
              s.mp_preapproval_id IS NOT NULL AND s.mp_preapproval_id <> ''
              AND c.mp_preapproval_id = s.mp_preapproval_id
            )
            OR (
              s.external_reference IS NOT NULL AND s.external_reference <> ''
              AND c.external_reference = s.external_reference
            )
          )
      ) pay ON TRUE
      WHERE
        (${appId} = '' OR s.app_id::text = ${appId})
        AND (${filterCollector} = '' OR s.collector_id = ${filterCollector})
        AND (
          ${filterCollector} <> ''
          OR COALESCE(cl.blacklisted, FALSE) = FALSE
        )
        AND COALESCE(s.hidden, FALSE) = FALSE
        AND (${mpStatus} = '' OR lower(COALESCE(s.status, '')) = lower(${mpStatus}))
        AND (
          ${qLike}::text IS NULL
          OR COALESCE(s.reason, '') ILIKE ${qLike}
          OR COALESCE(s.payer_email, '') ILIKE ${qLike}
          OR COALESCE(cl.name, '') ILIKE ${qLike}
          OR COALESCE(s.collector_name, '') ILIKE ${qLike}
          OR COALESCE(s.mp_preapproval_id, '') ILIKE ${qLike}
        )
        AND (
          ${hubStatus} = 'all'
          OR (${hubStatus} = '' AND COALESCE(s.hub_status, 'accepted') <> 'rejected')
          OR COALESCE(s.hub_status, 'accepted') = ${hubStatus}
        )
      ORDER BY
        CASE COALESCE(s.hub_status, 'accepted')
          WHEN 'pending' THEN 0
          WHEN 'accepted' THEN 1
          ELSE 2
        END,
        s.updated_at DESC
      LIMIT 200
    `;

    const subKpis = await sql`
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(s.hub_status, 'accepted') = 'pending')::int AS pending_count,
        COUNT(*) FILTER (
          WHERE COALESCE(s.hub_status, 'accepted') = 'accepted' AND s.status = 'authorized'
        )::int AS active_count,
        COALESCE(SUM(s.amount) FILTER (
          WHERE COALESCE(s.hub_status, 'accepted') = 'accepted' AND s.status = 'authorized'
        ), 0)::float8 AS monthly_recurring,
        COUNT(*) FILTER (WHERE COALESCE(s.hub_status, 'accepted') = 'accepted')::int AS accepted_count,
        COUNT(*) FILTER (WHERE COALESCE(s.hub_status, 'accepted') = 'rejected')::int AS rejected_count
      FROM hub_subscriptions s
      LEFT JOIN hub_clients cl
        ON cl.app_id = s.app_id AND cl.collector_id = s.collector_id
      WHERE
        (${appId} = '' OR s.app_id::text = ${appId})
        AND (${filterCollector} = '' OR s.collector_id = ${filterCollector})
        AND (
          ${filterCollector} <> ''
          OR COALESCE(cl.blacklisted, FALSE) = FALSE
        )
        AND COALESCE(s.hidden, FALSE) = FALSE
    `;

    const totalCount = Number(totals[0]?.count || 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    return NextResponse.json({
      charges,
      subscriptions,
      totals: {
        ...(totals[0] || {
          count: 0,
          amount: 0,
          approved_amount: 0,
          approved_amount_gross: 0,
          approved_count: 0,
        }),
        active_count: Number(subKpis[0]?.active_count || 0),
        monthly_recurring: Number(subKpis[0]?.monthly_recurring || 0),
        pending_count: Number(subKpis[0]?.pending_count || 0),
        accepted_count: Number(subKpis[0]?.accepted_count || 0),
        rejected_count: Number(subKpis[0]?.rejected_count || 0),
      },
      page,
      limit,
      totalPages,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Error al cargar suscripciones",
        charges: [],
        subscriptions: [],
        totals: {
          count: 0,
          amount: 0,
          approved_amount: 0,
          approved_amount_gross: 0,
          approved_count: 0,
          active_count: 0,
          monthly_recurring: 0,
          pending_count: 0,
          accepted_count: 0,
          rejected_count: 0,
        },
      },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    hub_status?: string;
    hubStatus?: string;
    charge_id?: string;
    charge_ids?: string[];
    mp_fee_pct?: number | string;
    mp_net_amount?: number | string;
    mp_fee_auto?: boolean;
  };

  const chargeIds = Array.isArray(body.charge_ids)
    ? body.charge_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : body.charge_id
      ? [String(body.charge_id).trim()]
      : [];

  if (chargeIds.length) {
    if (body.mp_fee_auto) {
      const results = [];
      for (const chargeId of chargeIds) {
        results.push(await resetChargeMpFeeAuto(chargeId));
      }
      const first = results[0];
      if (results.length === 1 && first && !first.ok) {
        return NextResponse.json(
          { error: first.reason === "no encontrado" ? "Cobro no encontrado" : "No se pudo detectar" },
          { status: first.reason === "no encontrado" ? 404 : 400 },
        );
      }
      await logActivity(
        "subscription",
        results.length === 1
          ? "Comisión MP volvió a detectarse sola"
          : `Comisión MP auto en ${results.length} cobros`,
        { charge_ids: chargeIds },
      );
      return NextResponse.json({ ok: true, auto: true, results });
    }

    if (body.mp_net_amount != null && body.mp_fee_pct == null) {
      const net = Number(body.mp_net_amount);
      if (!Number.isFinite(net)) {
        return NextResponse.json({ error: "Neto inválido" }, { status: 400 });
      }
      const row = await setChargeMpNetAmount(chargeIds[0], net);
      if (!row) {
        return NextResponse.json({ error: "Cobro no encontrado" }, { status: 404 });
      }
      await logActivity("subscription", `Comisión MP: neto ${row.mp_net_amount}`, {
        charge_id: row.id,
        mp_fee_pct: row.mp_fee_pct,
        mp_net_amount: row.mp_net_amount,
      });
      return NextResponse.json({ ok: true, charge: row });
    }

    if (body.mp_fee_pct == null) {
      return NextResponse.json(
        { error: "Falta mp_fee_pct, mp_net_amount o mp_fee_auto" },
        { status: 400 },
      );
    }
    const pct = clampMpFeePct(Number(body.mp_fee_pct));
    const updated = await setChargesMpFeePct(chargeIds, pct);
    if (!updated.length) {
      return NextResponse.json({ error: "Cobro no encontrado" }, { status: 404 });
    }
    await logActivity(
      "subscription",
      updated.length === 1
        ? `Comisión MP ${updated[0].mp_fee_pct}%`
        : `Comisión MP ${pct}% en ${updated.length} cobros`,
      { charge_ids: chargeIds, mp_fee_pct: pct },
    );
    return NextResponse.json({ ok: true, mp_fee_pct: pct, charges: updated });
  }

  const id = String(body.id || "").trim();
  const hubStatus = parseHubStatus(body.hub_status || body.hubStatus);
  if (!id || !hubStatus) {
    return NextResponse.json(
      { error: "Falta id o hub_status (pending, accepted, rejected)" },
      { status: 400 },
    );
  }

  const row = await setSubscriptionHubStatus(id, hubStatus);
  if (!row) {
    return NextResponse.json({ error: "Suscripción no encontrada" }, { status: 404 });
  }

  let importedCharges = 0;
  let mailed = 0;
  if (hubStatus === "accepted") {
    const app = await getAppById(String(row.app_id));
    const token = app ? decrypt(app.access_token) : "";
    const preId = row.mp_preapproval_id ? String(row.mp_preapproval_id) : "";
    if (token && preId) {
      importedCharges = await syncAuthorizedPaymentsForPreapproval(
        String(row.app_id),
        token,
        preId,
      );
    }
    mailed = await notifyUnsentChargesForSubscription(
      String(row.app_id),
      id,
      "accept",
    );
  }

  const name = String(row.collector_name || "cliente");
  const verb =
    hubStatus === "accepted"
      ? "entró a Prodi Software"
      : hubStatus === "rejected"
        ? "no entra a Prodi Software"
        : "volvió a pendiente";
  await logActivity(
    "subscription",
    `Suscripción ${name}: ${verb}`,
    {
      subscription_id: id,
      hub_status: hubStatus,
      mp_preapproval_id: row.mp_preapproval_id || null,
      imported_charges: importedCharges,
      mailed,
    },
  );

  return NextResponse.json({
    ok: true,
    hub_status: hubStatus,
    imported_charges: importedCharges,
    mailed,
    subscription: row,
  });
}
