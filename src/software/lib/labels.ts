export function paymentStatusEs(status?: string | null) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "Aprobado";
  if (s === "pending" || s === "pending_fee" || s === "in_process" || s === "in_mediation") {
    return "Pendiente";
  }
  if (s === "rejected") return "Rechazado";
  if (s === "cancelled" || s === "canceled") return "Cancelado";
  if (s === "refunded" || s === "charged_back") return "Reembolsado";
  if (s === "authorized") return "Autorizado";
  if (!s || s === "unknown") return "Sin estado";
  return status || "Sin estado";
}

export function statusTone(status?: string | null) {
  const s = String(status || "").toLowerCase();
  if (
    s === "approved" ||
    s === "authorized" ||
    s === "ok" ||
    s === "accepted" ||
    s === "released"
  ) {
    return "ok";
  }
  if (
    s === "rejected" ||
    s === "cancelled" ||
    s === "canceled" ||
    s === "refunded" ||
    s === "charged_back" ||
    s === "error"
  ) {
    return "error";
  }
  return "pending";
}

export function mpPlanStatusEs(status?: string | null) {
  const s = String(status || "").toLowerCase();
  if (s === "authorized") return "Activa en Mercado Pago";
  if (s === "paused") return "Pausada";
  if (s === "cancelled" || s === "canceled") return "Cancelada";
  if (s === "pending") return "No se activó";
  return paymentStatusEs(status);
}

export function activityTypeEs(type?: string | null) {
  const map: Record<string, string> = {
    sync: "Sync",
    ingest: "Ingreso",
    subscription: "Suscripción",
    payout: "Transferencia",
    payout_undo: "Anulación",
    client_blacklist: "Lista negra",
    client_restore: "Restaurado",
    client_rename: "Nombre",
    partner_update: "Socios",
    client_pct: "Porcentaje",
    app_save: "App",
    cleanup: "Limpieza",
    maintenance: "Mantenimiento",
    extra: "Otro cobro",
    expense: "Gasto",
  };
  return map[String(type || "")] || String(type || "Actividad");
}

export function relTime(iso: string | number | null | undefined) {
  if (iso == null || iso === "") return "";
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} d`;
}
