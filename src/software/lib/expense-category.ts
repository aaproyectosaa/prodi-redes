export type ExpenseCategory =
  | "servicios"
  | "sueldos"
  | "impuestos"
  | "retiros"
  | "otros";

export const EXPENSE_CATEGORIES: Array<{ id: ExpenseCategory; label: string }> = [
  { id: "servicios", label: "Servicios" },
  { id: "sueldos", label: "Sueldos" },
  { id: "impuestos", label: "Impuestos" },
  { id: "retiros", label: "Retiros" },
  { id: "otros", label: "Otros" },
];

export function parseExpenseCategory(raw: unknown): ExpenseCategory {
  const s = String(raw || "").trim();
  if (s === "servicios") return "servicios";
  if (s === "sueldos") return "sueldos";
  if (s === "impuestos") return "impuestos";
  if (s === "retiros") return "retiros";
  return "otros";
}

export function expenseCategoryLabel(raw?: string | null) {
  const s = String(raw || "").trim();
  return EXPENSE_CATEGORIES.find((c) => c.id === s)?.label || s || "Otros";
}
