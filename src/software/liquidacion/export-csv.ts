import type { BreakdownRow, Item, Source } from "./types";

export function exportLiquidacionCsv(opts: {
  from: string;
  to: string;
  totalFee: number;
  paymentsCount: number;
  totalMaintenance: number;
  maintenanceCount: number;
  totalExtra: number;
  extraCount: number;
  totalSubscription: number;
  subscriptionCount: number;
  feeItems: Item[];
  maintenanceItems: Item[];
  extraItems: Item[];
  subscriptionItems: Item[];
  breakdown: BreakdownRow[];
}) {
  const lines = ["consolidado;socio;corresponde;pagado;pendiente"];
  const names = new Map<string, { name: string; share: number; paid: number; pending: number }>();
  for (const item of [
    ...opts.feeItems,
    ...opts.maintenanceItems,
    ...opts.extraItems,
    ...opts.subscriptionItems,
  ]) {
    const cur = names.get(item.partner_id) || {
      name: item.partner_name,
      share: 0,
      paid: 0,
      pending: 0,
    };
    cur.share += item.share;
    cur.paid += item.paid;
    cur.pending += item.pending;
    names.set(item.partner_id, cur);
  }
  for (const row of names.values()) {
    lines.push(["total", row.name, row.share, row.paid, row.pending].join(";"));
  }
  lines.push("");
  lines.push("tipo;socio;corresponde;pagado;pendiente");
  const addItems = (source: Source | "mantenimiento" | "suscripcion", items: Item[]) => {
    for (const item of items) {
      lines.push([source, item.partner_name, item.share, item.paid, item.pending].join(";"));
    }
  };
  addItems("fee", opts.feeItems);
  addItems("mantenimiento", opts.maintenanceItems);
  addItems("extra", opts.extraItems);
  addItems("suscripcion", opts.subscriptionItems);
  lines.push("");
  lines.push("origen;cliente;monto;socio;pct;share");
  for (const row of opts.breakdown) {
    for (const share of row.shares) {
      const source =
        row.source === "maintenance"
          ? "mantenimiento"
          : row.source === "extra"
            ? "extra"
            : row.source === "subscription"
              ? "suscripcion"
              : "fee";
      lines.push([source, row.client_name, row.fee, share.partner_name, share.pct, share.share].join(";"));
    }
  }
  lines.push("");
  lines.push(`fee_liberado;${opts.totalFee}`);
  lines.push(`pagos_fee_liberados;${opts.paymentsCount}`);
  lines.push(`mantenimientos;${opts.totalMaintenance}`);
  lines.push(`cobros_mant;${opts.maintenanceCount}`);
  lines.push(`extras;${opts.totalExtra}`);
  lines.push(`cobros_extra;${opts.extraCount}`);
  lines.push(`suscripciones;${opts.totalSubscription}`);
  lines.push(`cobros_suscrip;${opts.subscriptionCount}`);
  lines.push(`desde;${opts.from}`);
  lines.push(`hasta;${opts.to}`);
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `liquidacion_${opts.from}_${opts.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
