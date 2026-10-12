import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "../next-shim";
import { decrypt, getAppById, upsertPaymentFromMp } from "../apps";
import { getSql } from "../sql";
import {
  extractFee,
  fetchAuthorizedPayment,
  fetchPayment,
  fetchPreapproval,
  isMarketplacePayment,
  isQrPayment,
  isSubscriptionPayment,
  mpFetch,
  type MpPayment,
} from "../mp";
import {
  maybeNotifyCharge,
  upsertFromAuthorizedPayment,
  upsertSubscriptionChargeFromMp,
  upsertSubscriptionFromMp,
} from "../subscriptions";

type Ctx = { params: Promise<{ appId: string }> };

function validSignature(
  secret: string,
  rawBody: string,
  xSignature: string | null,
  xRequestId: string | null,
) {
  if (!secret || !xSignature) return !secret;
  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, v] = p.trim().split("=");
      return [k, v];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  let dataId = "";
  try {
    const parsed = JSON.parse(rawBody) as { data?: { id?: string } };
    dataId = parsed?.data?.id != null ? String(parsed.data.id) : "";
  } catch {
    /* ignore */
  }
  const candidates = [
    `id:${dataId};request-id:${xRequestId || ""};ts:${ts};`,
    `id:${dataId.toLowerCase()};request-id:${xRequestId || ""};ts:${ts};`,
  ];
  try {
    const sig = Buffer.from(v1, "hex");
    for (const manifest of candidates) {
      const expected = createHmac("sha256", secret).update(manifest).digest();
      if (expected.length === sig.length && timingSafeEqual(expected, sig)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function parseBody(rawBody: string) {
  try {
    return JSON.parse(rawBody || "{}") as {
      data?: { id?: string | number };
      id?: string | number;
      type?: string;
      action?: string;
      topic?: string;
      resource?: string;
      entity?: string;
    };
  } catch {
    return {};
  }
}

function extractResourceId(rawBody: string, req: NextRequest): {
  id: string | null;
  kind: "payment" | "order" | "preapproval" | "authorized_payment" | "unknown";
} {
  const body = parseBody(rawBody);
  const qType =
    req.nextUrl.searchParams.get("type") ||
    req.nextUrl.searchParams.get("topic") ||
    "";
  const type = String(body.type || body.topic || body.entity || qType).toLowerCase();

  let id: string | null = null;
  if (body.data?.id != null) id = String(body.data.id);
  else if (body.id != null && (type.includes("payment") || type.includes("order") || type.includes("subscription") || type.includes("preapproval"))) {
    id = String(body.id);
  } else if (body.resource) {
    const m = String(body.resource).match(/(\d{6,}|[A-Z0-9-]{8,})/i);
    if (m) id = m[1];
  }
  if (!id) {
    id =
      req.nextUrl.searchParams.get("data.id") ||
      req.nextUrl.searchParams.get("id");
  }

  if (type.includes("authorized_payment")) {
    return { id, kind: "authorized_payment" };
  }
  if (type.includes("preapproval_plan")) return { id, kind: "unknown" };
  if (type.includes("preapproval") || type.includes("subscription")) {
    return { id, kind: "preapproval" };
  }
  if (type.includes("order")) return { id, kind: "order" };
  if (type.includes("payment") || !type) return { id, kind: "payment" };
  return { id, kind: "unknown" };
}

async function markOk(appId: string) {
  const sql = getSql();
  await sql`
    UPDATE hub_mp_apps SET
      webhook_status = 'ok',
      last_webhook_at = NOW(),
      updated_at = NOW()
    WHERE id = ${appId}
  `;
}

async function importIfMarketplace(
  appId: string,
  payment: MpPayment,
  accessToken?: string | null,
) {
  const fee = extractFee(payment);
  const approved = payment.status === "approved";
  const marketplaceLike =
    isMarketplacePayment(payment) || isQrPayment(payment);

  // Con fee: importar. Sin fee pero approved + marketplace/QR: guardar pending_fee
  // (MP a veces liquida application_fee después; el sync reintenta para todos).
  if (fee <= 0 && !(approved && marketplaceLike)) {
    return {
      imported: false,
      fee,
      skipped: true as const,
      reason: "sin fee de marketplace",
    };
  }

  const saved = await upsertPaymentFromMp(appId, payment, {
    accessToken: accessToken || null,
  });

  if (fee <= 0) {
    return {
      imported: false,
      pending_retry: true,
      fee: 0,
      skipped: false as const,
      reason: "pendiente de fee",
      qr: isQrPayment(payment),
    };
  }

  if (saved.isNew || saved.feeRecovered) {
    const { notifyFeeOnce } = await import("../mail");
    await notifyFeeOnce(appId, {
      clientName: saved.clientName,
      mpPaymentId: saved.mpPaymentId,
      amount: saved.amount,
      fee: saved.fee,
      status: saved.status,
      description: saved.description,
      paidAt: saved.paidAt,
      source: "webhook",
    });
  }
  return {
    imported: true,
    isNew: saved.isNew,
    feeRecovered: saved.feeRecovered,
    fee,
    skipped: false as const,
    qr: isQrPayment(payment),
  };
}

async function importIfSubscription(
  appId: string,
  payment: MpPayment,
  accessToken?: string | null,
) {
  if (!isSubscriptionPayment(payment)) {
    return { imported: false as const, skipped: true as const };
  }
  const saved = await upsertSubscriptionChargeFromMp(appId, payment, {
    accessToken: accessToken || null,
  });
  if (saved.saved) await maybeNotifyCharge(appId, saved, "webhook");
  return {
    imported: saved.saved,
    isNew: saved.saved ? saved.isNew : false,
    skipped: !saved.saved,
  };
}

async function paymentsFromOrder(token: string, orderId: string): Promise<MpPayment[]> {
  const { ok, data } = await mpFetch<{
    id?: string;
    transactions?: { payments?: Array<{ id?: string | number }> };
    type?: string;
  }>(`/v1/orders/${orderId}`, token);
  if (!ok) return [];

  const ids = (data.transactions?.payments || [])
    .map((p) => (p.id != null ? String(p.id) : ""))
    .filter(Boolean);

  const out: MpPayment[] = [];
  for (const pid of ids) {
    // Algunos IDs de order no son numéricos de /v1/payments
    if (!/^\d+$/.test(pid)) continue;
    const detail = await fetchPayment(token, pid);
    if (detail.ok && detail.data?.id) out.push(detail.data);
  }
  return out;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { appId } = await ctx.params;
  const app = await getAppById(appId);
  if (!app) return NextResponse.json({ error: "App desconocida" }, { status: 404 });

  const rawBody = await req.text();
  const isTest = req.headers.get("x-hub-test") === "1";

  if (isTest) {
    await markOk(appId);
    return NextResponse.json({ ok: true, test: true });
  }

  const secret = decrypt(app.webhook_secret);
  const xSig = req.headers.get("x-signature");
  // QR: MP indica que no siempre se valida con secret. Solo rechazamos
  // si tenemos secret guardado Y la firma viene y es inválida.
  if (secret && xSig) {
    const sigOk = validSignature(secret, rawBody, xSig, req.headers.get("x-request-id"));
    if (!sigOk) {
      // Igual 200 para no spamear reintentos de simulaciones mal firmadas;
      // marcamos error interno.
      const sql = getSql();
      await sql`
        UPDATE hub_mp_apps SET webhook_status = 'error', updated_at = NOW() WHERE id = ${appId}
      `;
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 200 });
    }
  }

  const { id: resourceId, kind } = extractResourceId(rawBody, req);

  if (!resourceId) {
    await markOk(appId);
    return NextResponse.json({ ok: true, note: "sin resource id" });
  }

  // Simulación de MP usa id 123456: no existe, no debe devolver 502
  if (resourceId === "123456" || resourceId === "test") {
    await markOk(appId);
    return NextResponse.json({
      ok: true,
      simulated: true,
      note: "ID de prueba de Mercado Pago recibido",
    });
  }

  const token = decrypt(app.access_token);
  if (!token) {
    await markOk(appId);
    return NextResponse.json({ ok: false, error: "Sin access token" }, { status: 200 });
  }

  try {
    const results = [];
    if (kind === "preapproval") {
      const pre = await fetchPreapproval(token, resourceId);
      if (!pre.ok || !pre.data?.id) {
        await markOk(appId);
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "preapproval no legible aún",
          resourceId,
          kind,
        });
      }
      const sub = await upsertSubscriptionFromMp(app.id, pre.data, {
        accessToken: token,
      });
      results.push({
        imported: Boolean(sub),
        kind: "preapproval",
        status: pre.data.status,
      });
    } else if (kind === "authorized_payment") {
      const auth = await fetchAuthorizedPayment(token, resourceId);
      if (!auth.ok || auth.data?.id == null) {
        await markOk(appId);
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "authorized_payment no legible aún",
          resourceId,
          kind,
        });
      }
      const saved = await upsertFromAuthorizedPayment(app.id, auth.data, {
        accessToken: token,
      });
      if (saved.saved) await maybeNotifyCharge(app.id, saved, "webhook");
      results.push(saved);
    } else {
      const payments: MpPayment[] = [];

      if (kind === "order") {
        const fromOrder = await paymentsFromOrder(token, resourceId);
        payments.push(...fromOrder);
        if (!fromOrder.length && /^\d+$/.test(resourceId)) {
          const { ok, data } = await fetchPayment(token, resourceId);
          if (ok && data?.id) payments.push(data);
        }
      } else {
        const { ok, data } = await fetchPayment(token, resourceId);
        if (ok && data?.id) payments.push(data);
      }

      if (!payments.length) {
        await markOk(appId);
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "pago/order no legible aún",
          resourceId,
          kind,
        });
      }

      for (const p of payments) {
        results.push(await importIfMarketplace(appId, p, token));
        results.push(await importIfSubscription(appId, p, token));
      }
    }

    await markOk(appId);
    return NextResponse.json({
      ok: true,
      resourceId,
      kind,
      results,
    });
  } catch (e) {
    // No devolver 5xx: MP lo interpreta como URL caída y reintenta.
    await markOk(appId);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Error webhook",
      },
      { status: 200 },
    );
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return POST(req, ctx);
}
