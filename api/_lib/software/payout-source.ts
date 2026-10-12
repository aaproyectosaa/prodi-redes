export type PayoutSource = "fee" | "maintenance" | "extra" | "subscription";

export function parsePayoutSource(raw: unknown): PayoutSource {
  const s = String(raw || "").trim();
  if (s === "maintenance") return "maintenance";
  if (s === "extra") return "extra";
  if (s === "subscription") return "subscription";
  return "fee";
}

export function sourceShortLabel(source: PayoutSource) {
  if (source === "maintenance") return "mant.";
  if (source === "extra") return "extra";
  if (source === "subscription") return "suscrip.";
  return "fee";
}

export function sourceKindLabel(source: PayoutSource) {
  if (source === "maintenance") return "mantenimiento";
  if (source === "extra") return "extra";
  if (source === "subscription") return "suscripción";
  return "fee";
}
