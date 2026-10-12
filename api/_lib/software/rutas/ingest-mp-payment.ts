import { NextRequest, NextResponse } from "../next-shim";
import { logActivity } from "../activity";
import { decrypt, getAppById, listApps, upsertPaymentFromMp } from "../apps";
import { extractFee, fetchPayment } from "../mp";

function authorized(req: NextRequest) {
  const expected = (process.env.INGEST_SECRET || "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = req.headers.get("x-ingest-secret")?.trim() || "";
  return bearer === expected || alt === expected;
}

/**
 * Dulce (u otra caja) avisa un cobro QR con el ID de Mercado Pago.
 * Body: { mp_payment_id: "172415610560", app_id?: "...", pos_code?: "POS-..." }
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

  const body = (await req.json().catch(() => ({}))) as {
    mp_payment_id?: string | number;
    payment_id?: string | number;
    app_id?: string;
    pos_code?: string;
    external_reference?: string;
    client_name?: string;
    store_name?: string;
    page_name?: string;
  };

  const mpId = String(body.mp_payment_id || body.payment_id || "").trim();
  if (!/^\d{6,}$/.test(mpId)) {
    return NextResponse.json(
      { error: "mp_payment_id inválido (el número de MP: …)" },
      { status: 400 },
    );
  }

  let app = body.app_id ? await getAppById(body.app_id) : null;
  if (!app) {
    const apps = await listApps();
    app = apps[0] || null;
  }
  if (!app) {
    return NextResponse.json({ error: "No hay app MP configurada" }, { status: 400 });
  }

  const token = decrypt(app.access_token);
  if (!token) {
    return NextResponse.json({ error: "App sin access token" }, { status: 400 });
  }

  const { ok, status, data } = await fetchPayment(token, mpId);
  if (!ok || !data?.id) {
    return NextResponse.json(
      {
        error: "Mercado Pago no devolvió el pago",
        mp_status: status,
        mp_payment_id: mpId,
      },
      { status: 502 },
    );
  }

  const fee = extractFee(data);
  const preferredClientName = String(
    body.client_name || body.store_name || body.page_name || "",
  ).trim();

  // Siempre persistimos el pago: si aún no hay fee, queda pending_fee y el sync lo reintenta
  // (vale para todos los clientes del marketplace, no solo uno).
  const saved = await upsertPaymentFromMp(app.id, data, {
    preferredClientName: preferredClientName || null,
    accessToken: token,
  });

  if (fee <= 0) {
    await logActivity(
      "ingest",
      `Ingest ${mpId}: pendiente de fee (se reintenta en sync)${
        body.pos_code ? ` · ${body.pos_code}` : ""
      }${saved.clientName ? ` · ${saved.clientName}` : ""}`,
      {
        mp_payment_id: mpId,
        pos_code: body.pos_code || null,
        amount: data.transaction_amount,
        client_name: saved.clientName || preferredClientName || null,
        app_id: app.id,
        pending_fee: true,
      },
    );
    return NextResponse.json({
      ok: true,
      imported: false,
      pending_retry: true,
      reason: "sin fee de marketplace (pendiente de reintento)",
      mp_payment_id: mpId,
      amount: data.transaction_amount,
      fee: 0,
      status: saved.status,
      client_name: saved.clientName || preferredClientName || null,
    });
  }

  await logActivity(
    "ingest",
    `Ingest ${mpId}: fee $${fee}${body.pos_code ? ` · ${body.pos_code}` : ""}${
      saved.clientName ? ` · ${saved.clientName}` : ""
    }`,
    {
      mp_payment_id: mpId,
      fee,
      amount: data.transaction_amount,
      pos_code: body.pos_code || null,
      external_reference: body.external_reference || null,
      client_name: saved.clientName || preferredClientName || null,
      app_id: app.id,
    },
  );

  if (saved.isNew || saved.feeRecovered) {
    const { notifyFeeOnce } = await import("../mail");
    await notifyFeeOnce(app.id, {
      clientName: saved.clientName,
      mpPaymentId: saved.mpPaymentId,
      amount: saved.amount,
      fee: saved.fee,
      status: saved.status,
      description: saved.description,
      posCode: body.pos_code || body.external_reference || null,
      paidAt: saved.paidAt,
      source: "ingest",
    });
  }

  return NextResponse.json({
    ok: true,
    imported: true,
    is_new: saved.isNew,
    fee_recovered: saved.feeRecovered,
    mp_payment_id: mpId,
    amount: data.transaction_amount,
    fee,
    status: data.status,
    description: data.description || null,
    pos_code: body.pos_code || null,
    client_name: saved.clientName || preferredClientName || null,
  });
}
