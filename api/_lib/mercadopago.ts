/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente mínimo de Mercado Pago (Checkout Pro) por REST.

import crypto from "crypto";

const API = "https://api.mercadopago.com";

function token(): string {
  const t = process.env.MP_ACCESS_TOKEN;
  if (!t) throw new Error("Falta MP_ACCESS_TOKEN en Vercel");
  return t;
}

async function mp(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Pago: ${json?.message ?? res.status}`);
  return json;
}

export async function crearPreferencia(params: {
  titulo: string;
  monto: number;
  cantidad?: number;
  externalReference: string;
  notificationUrl: string;
  backUrl: string;
  email?: string;
}): Promise<{ id: string; init_point: string }> {
  const cantidad = params.cantidad ?? 1;
  const json = await mp("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [
        {
          id: params.externalReference,
          title: params.titulo,
          quantity: cantidad,
          unit_price: Math.round((params.monto / cantidad) * 100) / 100,
          currency_id: "ARS",
        },
      ],
      external_reference: params.externalReference,
      notification_url: params.notificationUrl,
      back_urls: {
        success: `${params.backUrl}&pago=ok`,
        pending: `${params.backUrl}&pago=pendiente`,
        failure: `${params.backUrl}&pago=error`,
      },
      auto_return: "approved",
      statement_descriptor: "PRODI",
      payer: params.email ? { email: params.email } : undefined,
    }),
  });
  return { id: json.id, init_point: json.init_point };
}

export interface PagoMP {
  id: number;
  status: string; // approved | pending | in_process | rejected | refunded | cancelled
  external_reference: string | null;
  transaction_amount: number;
  date_approved?: string | null;
}

export async function obtenerPago(id: string): Promise<PagoMP> {
  return mp(`/v1/payments/${encodeURIComponent(id)}`);
}

export async function buscarPagos(externalReference: string): Promise<PagoMP[]> {
  const json = await mp(
    `/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&sort=date_created&criteria=desc`
  );
  return (json.results ?? []) as PagoMP[];
}

export async function reembolsar(paymentId: string): Promise<void> {
  await mp(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
    method: "POST",
    headers: { "X-Idempotency-Key": `refund-${paymentId}` },
    body: JSON.stringify({}),
  });
}

/**
 * Valida la firma del webhook (x-signature). Si no hay MP_WEBHOOK_SECRET
 * configurado, no se valida (igual se consulta el pago a la API de MP, que
 * es la fuente de verdad).
 */
export function firmaValida(headers: Record<string, unknown>, dataId: string): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = String(headers["x-signature"] ?? "");
  // Notificaciones viejas (IPN, ?topic=payment) no vienen firmadas. No es un riesgo:
  // el pago siempre se vuelve a consultar a la API de Mercado Pago.
  if (!sig) return true;
  const reqId = String(headers["x-request-id"] ?? "");
  const parts = Object.fromEntries(
    sig.split(",").map((p) => p.trim().split("=").map((s) => s.trim()) as [string, string])
  );
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};${reqId ? `request-id:${reqId};` : ""}ts:${parts.ts};`;
  const hmac = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Suscripciones (débito automático del abono mensual)
// ---------------------------------------------------------------------------

export interface SuscripcionMP {
  id: string;
  status: string; // pending | authorized | paused | cancelled
  init_point?: string;
  external_reference?: string | null;
  payer_email?: string;
  auto_recurring?: { transaction_amount?: number };
}

export async function crearSuscripcion(params: {
  titulo: string;
  monto: number;
  email: string;
  externalReference: string;
  backUrl: string;
}): Promise<SuscripcionMP> {
  return mp("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: params.titulo,
      external_reference: params.externalReference,
      payer_email: params.email,
      back_url: params.backUrl,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: params.monto,
        currency_id: "ARS",
      },
    }),
  });
}

export async function obtenerSuscripcion(id: string): Promise<SuscripcionMP> {
  return mp(`/preapproval/${encodeURIComponent(id)}`);
}

export async function actualizarSuscripcion(
  id: string,
  cambios: { status?: "cancelled" | "paused" | "authorized"; monto?: number }
): Promise<SuscripcionMP> {
  return mp(`/preapproval/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({
      ...(cambios.status ? { status: cambios.status } : {}),
      ...(cambios.monto ? { auto_recurring: { transaction_amount: cambios.monto, currency_id: "ARS" } } : {}),
    }),
  });
}

export interface CobroSuscripcionMP {
  id: number;
  preapproval_id: string;
  status: string;
  transaction_amount: number;
  payment?: { id: number; status: string } | null;
  debit_date?: string | null;
}

export async function obtenerCobroSuscripcion(id: string): Promise<CobroSuscripcionMP> {
  return mp(`/authorized_payments/${encodeURIComponent(id)}`);
}
