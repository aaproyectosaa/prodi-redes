export type ChargeKind = "checkout" | "recurring" | "authorized";
export type HubStatus = "pending" | "accepted" | "rejected";

export type ChargeInput = {
  mpPaymentId?: string | null;
  mpAuthorizedPaymentId?: string | null;
  mpPreapprovalId?: string | null;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
  kind?: string | null;
  collectorId?: string | null;
  collectorName?: string | null;
  payerEmail?: string | null;
  description?: string | null;
  externalReference?: string | null;
  paidAt?: string | null;
  raw?: unknown;
};

export function parseHubStatus(raw: unknown): HubStatus | null {
  const s = String(raw || "").trim();
  if (s === "pending" || s === "accepted" || s === "rejected") return s;
  return null;
}

export function inferChargeKind(
  ref?: string | null,
  explicit?: string | null,
  operationType?: string | null,
): ChargeKind {
  const k = String(explicit || "").toLowerCase();
  if (k === "checkout" || k === "first" || k === "slot") return "checkout";
  if (k === "authorized") return "authorized";
  if (k === "recurring") return "recurring";
  const r = String(ref || "");
  if (r.startsWith("form-slot-")) return "checkout";
  if (String(operationType || "").toLowerCase().includes("recurring")) {
    return "recurring";
  }
  return "recurring";
}

export function chargeUid(opts: {
  mpPaymentId?: string | null;
  mpAuthorizedPaymentId?: string | null;
}) {
  const pay = text(opts.mpPaymentId);
  if (pay) return `pay:${pay}`;
  const auth = text(opts.mpAuthorizedPaymentId);
  if (auth) return `auth:${auth}`;
  return null;
}

export function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function text(v: unknown) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
