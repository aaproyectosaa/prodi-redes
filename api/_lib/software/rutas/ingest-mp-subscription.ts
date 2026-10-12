import { NextRequest, NextResponse } from "../next-shim";
import { logActivity } from "../activity";
import { decrypt, getAppById, listApps } from "../apps";
import { fetchAuthorizedPayment, fetchPayment, fetchPreapproval } from "../mp";
import {
  inferChargeKind,
  maybeNotifyCharge,
  upsertFromAuthorizedPayment,
  upsertSubscriptionCharge,
  upsertSubscriptionChargeFromMp,
  upsertSubscriptionFromMp,
} from "../subscriptions";

function authorized(req: NextRequest) {
  const expected = (process.env.INGEST_SECRET || "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = req.headers.get("x-ingest-secret")?.trim() || "";
  return bearer === expected || alt === expected;
}

type IngestBody = {
  mp_payment_id?: string | number;
  payment_id?: string | number;
  mp_preapproval_id?: string;
  preapproval_id?: string;
  mp_authorized_payment_id?: string | number;
  authorized_payment_id?: string | number;
  app_id?: string;
  client_name?: string;
  store_name?: string;
  page_name?: string;
  kind?: string;
  amount?: number;
  currency?: string;
  status?: string;
  description?: string;
  reason?: string;
  external_reference?: string;
  payer_email?: string;
  frequency?: number;
  frequency_type?: string;
};

/**
 * Green Air (u otro cliente) avisa un cobro de suscripción MP.
 * Body: { mp_payment_id?, mp_preapproval_id?, mp_authorized_payment_id?, client_name?, kind? }
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!(process.env.INGEST_SECRET || "").trim()) {
    return NextResponse.json(
      { error: "Falta INGEST_SECRET en el servidor" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as IngestBody;
  const mpId = String(body.mp_payment_id || body.payment_id || "").trim();
  const preId = String(body.mp_preapproval_id || body.preapproval_id || "").trim();
  const authId = String(
    body.mp_authorized_payment_id || body.authorized_payment_id || "",
  ).trim();

  if (!mpId && !preId && !authId) {
    return NextResponse.json(
      { error: "Falta mp_payment_id, mp_preapproval_id o mp_authorized_payment_id" },
      { status: 400 },
    );
  }

  const preferredClientName = String(
    body.client_name || body.store_name || body.page_name || "",
  ).trim();

  const apps = await listApps();
  let app = body.app_id ? await getAppById(body.app_id) : null;
  let token = app ? decrypt(app.access_token) : "";
  let payment = null as Awaited<ReturnType<typeof fetchPayment>>["data"] | null;
  let preapproval = null as Awaited<ReturnType<typeof fetchPreapproval>>["data"] | null;
  let authorizedPay =
    null as Awaited<ReturnType<typeof fetchAuthorizedPayment>>["data"] | null;

  const tryApps = app ? [app, ...apps.filter((a) => a.id !== app!.id)] : apps;

  for (const candidate of tryApps) {
    const t = decrypt(candidate.access_token);
    if (!t) continue;
    if (mpId && /^\d{6,}$/.test(mpId) && !payment) {
      const detail = await fetchPayment(t, mpId);
      if (detail.ok && detail.data?.id) {
        app = candidate;
        token = t;
        payment = detail.data;
      }
    }
    if (preId && !preapproval) {
      const pre = await fetchPreapproval(t, preId);
      if (pre.ok && pre.data?.id) {
        app = candidate;
        token = t;
        preapproval = pre.data;
      }
    }
    if (authId && !authorizedPay) {
      const auth = await fetchAuthorizedPayment(t, authId);
      if (auth.ok && auth.data?.id != null) {
        app = candidate;
        token = t;
        authorizedPay = auth.data;
      }
    }
    if ((mpId ? payment : true) && (preId ? preapproval : true) && (authId ? authorizedPay : true)) {
      if (payment || preapproval || authorizedPay) break;
    }
  }

  if (!app) {
    app = apps[0] || null;
    token = app ? decrypt(app.access_token) : "";
  }
  if (!app) {
    return NextResponse.json({ error: "No hay app MP configurada" }, { status: 400 });
  }

  if (preapproval) {
    await upsertSubscriptionFromMp(app.id, preapproval, {
      preferredClientName: preferredClientName || null,
      accessToken: token || null,
    });
  }

  let chargeResult: Awaited<ReturnType<typeof upsertSubscriptionCharge>> | null =
    null;

  if (authorizedPay) {
    chargeResult = await upsertFromAuthorizedPayment(app.id, authorizedPay, {
      preferredClientName: preferredClientName || null,
      accessToken: token || null,
      payment,
    });
  } else if (payment) {
    chargeResult = await upsertSubscriptionChargeFromMp(app.id, payment, {
      preferredClientName: preferredClientName || null,
      accessToken: token || null,
      kind: body.kind || null,
      mpPreapprovalId: preId || null,
      mpAuthorizedPaymentId: authId || null,
    });
  } else if (mpId || authId) {
    chargeResult = await upsertSubscriptionCharge(
      app.id,
      {
        mpPaymentId: mpId || null,
        mpAuthorizedPaymentId: authId || null,
        mpPreapprovalId: preId || null,
        status: body.status || "approved",
        amount: Number(body.amount || 0),
        currency: body.currency || "ARS",
        kind: inferChargeKind(body.external_reference, body.kind, null),
        collectorName: preferredClientName || null,
        payerEmail: body.payer_email || null,
        description: body.description || body.reason || null,
        externalReference: body.external_reference || null,
        paidAt: new Date().toISOString(),
        raw: body,
      },
      { preferredClientName: preferredClientName || null, accessToken: token || null },
    );
  }

  if (chargeResult?.saved) {
    await maybeNotifyCharge(app.id, chargeResult, "ingest");
    await logActivity(
      "subscription",
      `Suscripción ingest ${chargeResult.mpPaymentId || authId || preId}: ${
        chargeResult.clientName || preferredClientName || "cliente"
      } · $${chargeResult.amount}`,
      {
        mp_payment_id: chargeResult.mpPaymentId,
        mp_preapproval_id: preId || null,
        mp_authorized_payment_id: authId || null,
        amount: chargeResult.amount,
        status: chargeResult.status,
        kind: chargeResult.kind,
        client_name: chargeResult.clientName || preferredClientName || null,
        app_id: app.id,
      },
    );
  } else if (preapproval) {
    await logActivity(
      "subscription",
      `Suscripción ${preId} actualizada (${preapproval.status || "—"}) · ${
        preferredClientName || "cliente"
      }`,
      {
        mp_preapproval_id: preId,
        status: preapproval.status || null,
        client_name: preferredClientName || null,
        app_id: app.id,
      },
    );
  }

  return NextResponse.json({
    ok: true,
    imported: Boolean(chargeResult?.saved || preapproval),
    is_new: chargeResult?.isNew || false,
    mp_payment_id: mpId || chargeResult?.mpPaymentId || null,
    mp_preapproval_id: preId || null,
    amount: chargeResult?.amount || Number(body.amount || 0),
    status: chargeResult?.status || preapproval?.status || body.status || null,
    kind: chargeResult?.kind || body.kind || null,
    client_name: chargeResult?.clientName || preferredClientName || null,
    hydrated_from_mp: Boolean(payment || preapproval || authorizedPay),
  });
}
