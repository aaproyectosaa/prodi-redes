import { expenseCategoryLabel } from "@/software/lib/expense-category";
import type { Expense, ExpenseTotals } from "./types";

export function exportGastosCsv(opts: {
  from: string;
  to: string;
  items: Expense[];
  totals: ExpenseTotals;
}) {
  const lines = ["fecha;descripcion;categoria;socio;monto;notas"];
  for (const e of opts.items) {
    const fecha = new Date(e.paid_at).toLocaleDateString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
    });
    lines.push(
      [
        fecha,
        e.description,
        expenseCategoryLabel(e.category),
        e.partner_name || "Caja común",
        e.amount,
        e.notes,
      ].join(";"),
    );
  }
  lines.push("");
  lines.push(`total;${opts.totals.total}`);
  lines.push(`cantidad;${opts.totals.count}`);
  lines.push(`desde;${opts.from}`);
  lines.push(`hasta;${opts.to}`);
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gastos_${opts.from}_${opts.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
