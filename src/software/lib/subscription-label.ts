/** Nombre visible del plan (no el nick de la cuenta MP). */

export function subscriptionPlanName(opts: {
  reason?: string | null;
  description?: string | null;
  clientName?: string | null;
  collectorName?: string | null;
}) {
  const reason = String(opts.reason || opts.description || "").trim();
  const fromReason = nameFromSubscriptionReason(reason);
  if (fromReason) return fromReason;

  const fallback = String(opts.clientName || opts.collectorName || "").trim();
  if (reason && !isMpAccountLabel(reason) && reason !== fallback) {
    return reason.length > 72 ? `${reason.slice(0, 72).trim()}…` : reason;
  }
  return fallback || "Suscripción";
}

/** Título genérico del plan Prodi: no es el nombre del cliente. */
export function isGenericProdiPlanLabel(name?: string | null) {
  return /^suscripci[oó]n(\s+a)?\s+prodi$/i.test(String(name || "").trim());
}

/**
 * "Prodi · test ariel · testeo de plataforma" → "test ariel"
 * "Green Air · 2 vendedores extra de feria" → "2 vendedores extra de feria"
 */
export function nameFromSubscriptionReason(reason?: string | null) {
  const raw = String(reason || "").trim();
  if (!raw) return null;
  const parts = raw
    .split(/\s*[·|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const name = parts[1];
    if (name.length >= 2 && !isMpAccountLabel(name)) return name;
  }
  return null;
}

function isMpAccountLabel(name: string) {
  const t = String(name || "").trim();
  if (!t) return true;
  if (/^digital\s*progreso$/i.test(t)) return true;
  if (/^cobranzas?\s*prodi$/i.test(t)) return true;
  if (isGenericProdiPlanLabel(t)) return true;
  if (/^[A-Z]{8,}$/.test(t.replace(/\s+/g, ""))) return true;
  return false;
}
