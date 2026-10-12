import { decrypt } from "./crypto";
import { clampMpFeePct } from "./money";

const MP_API = "https://api.mercadopago.com";

export type MpPayment = {
  id: number | string;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string | null;
  date_created?: string | null;
  description?: string | null;
  collector_id?: number | string;
  collector?: { id?: number | string } | null;
  payer?: { email?: string; id?: number | string };
  fee_details?: Array<{ type?: string; amount?: number; fee_payer?: string }>;
  transaction_details?: {
    net_received_amount?: number | string;
    total_paid_amount?: number | string;
  } | null;
  application_fee?: number;
  marketplace_fee?: number;
  marketplace?: string | null;
  operation_type?: string | null;
  external_reference?: string | null;
  metadata?: Record<string, unknown> | null;
  point_of_interaction?: {
    type?: string;
    business_info?: { branch?: string; unit?: string; sub_unit?: string };
  } | null;
  charges_details?: Array<{
    type?: string;
    name?: string;
    amounts?: { original?: number; refunded?: number };
    accounts?: { from?: string; to?: string };
  }>;
  [key: string]: unknown;
};

export type MpPreapproval = {
  id?: string;
  status?: string;
  reason?: string | null;
  payer_email?: string | null;
  payer_id?: number | string | null;
  collector_id?: number | string | null;
  external_reference?: string | null;
  date_created?: string | null;
  last_modified?: string | null;
  next_payment_date?: string | null;
  init_point?: string | null;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    transaction_amount?: number;
    currency_id?: string;
    start_date?: string | null;
    end_date?: string | null;
  } | null;
  summarized?: {
    quotas?: number;
    charged_quantity?: number;
    pending_charge_quantity?: number;
    charged_amount?: number;
    pending_charge_amount?: number;
    last_charged_date?: string | null;
    last_charged_amount?: number | null;
    semaphore?: string | null;
  } | null;
  [key: string]: unknown;
};

export type MpAuthorizedPayment = {
  id?: number | string;
  preapproval_id?: string;
  type?: string;
  status?: string;
  reason?: string | null;
  external_reference?: string | number | null;
  currency_id?: string;
  transaction_amount?: number | string;
  date_created?: string | null;
  last_modified?: string | null;
  debit_date?: string | null;
  payment?: {
    id?: number | string;
    status?: string;
    status_detail?: string;
  } | null;
  [key: string]: unknown;
};

export function extractFee(p: MpPayment): number {
  const details = p.fee_details || [];
  const appFee = details
    .filter((d) => d.type === "application_fee" || d.type === "marketplace_fee")
    .reduce((a, d) => a + Number(d.amount || 0), 0);
  if (appFee > 0) return Math.round(appFee * 100) / 100;

  // QR marketplace: a veces el fee solo viene en charges_details
  const fromCharges = (p.charges_details || [])
    .filter(
      (c) =>
        c.type === "fee" &&
        (c.accounts?.to === "marketplace_owner" ||
          c.name === "third_payment" ||
          c.name === "application_fee"),
    )
    .reduce((a, c) => a + Number(c.amounts?.original || 0), 0);
  if (fromCharges > 0) return Math.round(fromCharges * 100) / 100;

  if (p.application_fee) return Math.round(Number(p.application_fee) * 100) / 100;
  if (p.marketplace_fee) return Math.round(Number(p.marketplace_fee) * 100) / 100;
  return 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

const MP_PROCESSING_FEE_TYPES = new Set([
  "mercadopago_fee",
  "financing_fee",
  "coupon_fee",
  "ml_fee",
]);

function roundMoney2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Comisión de procesamiento de Mercado Pago (lo que resta al cobrado).
 * Prioriza transaction_details.net_received_amount (lo acreditado en MP).
 */
export function detectMpCommission(
  raw: unknown,
  gross?: number,
): { pct: number; net: number } | null {
  const p = asRecord(raw);
  if (!p) return null;
  const amount =
    gross && gross > 0 ? gross : Number(p.transaction_amount || 0);
  if (!(amount > 0)) return null;

  const details = asRecord(p.transaction_details);
  if (details && details.net_received_amount != null && details.net_received_amount !== "") {
    const net = Number(details.net_received_amount);
    if (Number.isFinite(net) && net >= 0 && net <= amount + 0.02) {
      const n = roundMoney2(Math.min(net, amount));
      return { net: n, pct: clampMpFeePct((1 - n / amount) * 100) };
    }
  }

  const fees = Array.isArray(p.fee_details) ? p.fee_details : [];
  let mpFee = 0;
  for (const item of fees) {
    const row = asRecord(item);
    if (!row) continue;
    const payer = String(row.fee_payer || "collector").toLowerCase();
    if (payer === "payer") continue;
    const type = String(row.type || "").toLowerCase();
    if (!MP_PROCESSING_FEE_TYPES.has(type)) continue;
    mpFee += Number(row.amount || 0);
  }
  if (mpFee > 0 && mpFee <= amount) {
    const net = roundMoney2(Math.max(amount - mpFee, 0));
    return { net, pct: clampMpFeePct((1 - net / amount) * 100) };
  }

  return null;
}

export function isQrPayment(p: MpPayment): boolean {
  const poi = p.point_of_interaction;
  if (!poi) return false;
  if (String(poi.type || "").toUpperCase() === "INSTORE") return true;
  const branch = String(poi.business_info?.branch || "").toUpperCase();
  const unit = String(poi.business_info?.unit || "").toUpperCase();
  const sub = String(poi.business_info?.sub_unit || "").toUpperCase();
  return branch === "QR" || unit === "WALLET" || sub === "QR";
}

/** Cobros de suscripciones MP (preapproval / débito recurrente / cupos Green Air). */
export function isSubscriptionPayment(p: MpPayment): boolean {
  const op = String(p.operation_type || "").toLowerCase();
  if (op.includes("recurring")) return true;

  const poi = String(p.point_of_interaction?.type || "").toUpperCase();
  if (poi.includes("SUBSCRIPTION")) return true;

  const ref = String(p.external_reference || "");
  if (ref.startsWith("form-slot-") || ref === "form-sellers-billing") return true;

  const meta = p.metadata || {};
  const kind = String(meta.kind || "").toLowerCase();
  if (kind === "form_seller_slot" || kind.includes("subscription")) return true;
  if (meta.preapproval_id || meta.subscription_id) return true;

  const desc = String(p.description || "").toLowerCase();
  if (
    desc.includes("vendedor extra") ||
    desc.includes("vendedores extra") ||
    desc.includes("cupo extra") ||
    desc.includes("cupos extra")
  ) {
    return true;
  }
  return false;
}

/** Pagos de marketplace / fee de app (incluye QR instore). */
export function isMarketplacePayment(p: MpPayment): boolean {
  if (extractFee(p) > 0) return true;
  const market = String(p.marketplace || "").toUpperCase();
  if (market && market !== "NONE" && market !== "NULL") return true;
  const details = p.fee_details || [];
  if (
    details.some(
      (d) => d.type === "application_fee" || d.type === "marketplace_fee",
    )
  ) {
    return true;
  }
  // QR con cargo al marketplace owner
  if (
    (p.charges_details || []).some(
      (c) => c.accounts?.to === "marketplace_owner" && Number(c.amounts?.original || 0) > 0,
    )
  ) {
    return true;
  }
  return false;
}

export async function mpFetch<T = unknown>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export async function validateAccessToken(token: string) {
  const { ok, data } = await mpFetch<{
    id?: number;
    nickname?: string;
    message?: string;
  }>("/users/me", token);
  if (!ok || !data?.id) {
    return {
      ok: false as const,
      error: (data as { message?: string })?.message || "Token inválido",
    };
  }
  return {
    ok: true as const,
    userId: String(data.id),
    nickname: data.nickname || null,
  };
}

/** Nickname / nombre público del vendedor (collector) en MP. */
export async function fetchCollectorDisplayName(
  token: string,
  collectorId: string,
): Promise<string | null> {
  const id = String(collectorId || "").trim();
  if (!id || id.startsWith("slug:")) return null;
  const { ok, data } = await mpFetch<{
    nickname?: string;
    first_name?: string;
    last_name?: string;
    message?: string;
  }>(`/users/${encodeURIComponent(id)}`, token);
  if (!ok) return null;
  const nick = String(data.nickname || "").trim();
  if (nick) return nick;
  const full = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  return full || null;
}

export function resolveToken(stored: string) {
  return decrypt(stored);
}

export async function fetchPayment(token: string, paymentId: string) {
  return mpFetch<MpPayment>(`/v1/payments/${paymentId}`, token);
}

export type SearchPaymentsOpts = {
  begin: string;
  end: string;
  offset?: number;
  limit?: number;
  range?: "date_created" | "date_approved" | "date_last_updated" | "money_release_date";
  collectorId?: string;
};

export async function searchPayments(token: string, opts: SearchPaymentsOpts) {
  const params = new URLSearchParams({
    range: opts.range || "date_created",
    begin_date: opts.begin,
    end_date: opts.end,
    sort: opts.range || "date_created",
    criteria: "desc",
    offset: String(opts.offset ?? 0),
    limit: String(opts.limit ?? 50),
  });
  if (opts.collectorId) params.set("collector.id", opts.collectorId);
  return mpFetch<{
    results?: MpPayment[];
    paging?: { total?: number; offset?: number; limit?: number };
  }>(`/v1/payments/search?${params}`, token);
}

/**
 * Trae candidatos de search (cuenta + cada collector conocido) y
 * hidrata con GET /payments/:id porque el search suele venir incompleto.
 */
export async function collectMarketplacePayments(
  token: string,
  opts: {
    begin: string;
    end: string;
    collectorIds?: string[];
    maxPages?: number;
  },
) {
  const limit = 50;
  const maxPages = opts.maxPages ?? 20;
  const seen = new Set<string>();
  const hydrated: MpPayment[] = [];
  const subscriptionPayments: MpPayment[] = [];
  let skipped = 0;
  let searched = 0;

  const queues: Array<{ collectorId?: string; range: SearchPaymentsOpts["range"] }> = [
    { range: "date_created" },
    { range: "date_approved" },
  ];
  // Por cada vendedor conocido: MP a veces no lista el QR en la cuenta dueña
  // pero sí filtrando collector.id
  for (const collectorId of opts.collectorIds || []) {
    if (!collectorId || collectorId.startsWith("slug:")) continue;
    queues.push({ collectorId, range: "date_created" });
  }

  for (const q of queues) {
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const { ok, data } = await searchPayments(token, {
        begin: opts.begin,
        end: opts.end,
        offset,
        limit,
        range: q.range,
        collectorId: q.collectorId,
      });
      if (!ok) break;
      const results = data.results || [];
      searched += results.length;
      for (const p of results) {
        const id = p?.id != null ? String(p.id) : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const detail = await fetchPayment(token, id);
        const full = detail.ok && detail.data?.id ? detail.data : p;
        if (isSubscriptionPayment(full)) subscriptionPayments.push(full);
        if (!isMarketplacePayment(full)) {
          // QR "Producto de X" sin fee en search incompleto: ya hidratamos;
          // si igual no hay fee de marketplace, no cuenta.
          skipped++;
          continue;
        }
        hydrated.push(full);
      }
      if (results.length < limit) break;
      offset += limit;
    }
  }

  return {
    payments: hydrated,
    subscriptionPayments,
    skipped,
    searched,
    uniqueIds: seen.size,
  };
}

export async function fetchPreapproval(token: string, id: string) {
  return mpFetch<MpPreapproval>(`/preapproval/${encodeURIComponent(id)}`, token);
}

export async function fetchAuthorizedPayment(token: string, id: string) {
  return mpFetch<MpAuthorizedPayment>(
    `/authorized_payments/${encodeURIComponent(id)}`,
    token,
  );
}

export async function searchPreapprovals(
  token: string,
  opts?: { status?: string; offset?: number; limit?: number; q?: string },
) {
  const params = new URLSearchParams({
    offset: String(opts?.offset ?? 0),
    limit: String(opts?.limit ?? 50),
  });
  if (opts?.status) params.set("status", opts.status);
  if (opts?.q) params.set("q", opts.q);
  return mpFetch<{
    results?: MpPreapproval[];
    paging?: { total?: number; offset?: number; limit?: number };
  }>(`/preapproval/search?${params}`, token);
}

export async function searchAuthorizedPayments(
  token: string,
  opts: {
    preapprovalId?: string;
    paymentId?: string;
    offset?: number;
    limit?: number;
  },
) {
  const params = new URLSearchParams({
    offset: String(opts.offset ?? 0),
    limit: String(opts.limit ?? 50),
  });
  if (opts.preapprovalId) params.set("preapproval_id", opts.preapprovalId);
  if (opts.paymentId) params.set("payment_id", opts.paymentId);
  return mpFetch<{
    results?: MpAuthorizedPayment[];
    paging?: { total?: number; offset?: number; limit?: number };
  }>(`/authorized_payments/search?${params}`, token);
}

export async function collectPreapprovals(
  token: string,
  opts?: { maxPages?: number },
) {
  const statuses = ["authorized", "pending", "paused", "cancelled"];
  const seen = new Set<string>();
  const out: MpPreapproval[] = [];
  const limit = 50;
  const maxPages = opts?.maxPages ?? 8;

  for (const status of statuses) {
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const { ok, data } = await searchPreapprovals(token, {
        status,
        offset,
        limit,
      });
      if (!ok) break;
      const results = data.results || [];
      for (const row of results) {
        const id = row?.id != null ? String(row.id) : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(row);
      }
      if (results.length < limit) break;
      offset += limit;
    }
  }

  return out;
}

export function getAppUrl() {
  return (process.env.APP_URL || process.env.VITE_APP_URL || "http://localhost:8080").replace(/\/$/, "");
}

export function webhookUrl(appId: string) {
  // Prodi: los avisos de Mercado Pago de cada app entran por /api/software/webhook-mp?app=<id>.
  return `${getAppUrl()}/api/software/webhook-mp?app=${encodeURIComponent(appId)}`;
}
