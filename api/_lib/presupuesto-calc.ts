// Presupuestos: tipos y totales (puro: lo usan el servidor y la pantalla).

export interface ItemPresupuesto {
  id: string;
  concepto: string;
  detalle?: string | null;
  cantidad: number;
  precio: number;
  periodo: "mensual" | "unico";
}

/** Totales: lo mensual y lo de una vez, con IVA si es factura. */
export function totalesPresupuesto(items: ItemPresupuesto[], tipo: string, ivaPct: number) {
  const suma = (p: ItemPresupuesto["periodo"]) => items.filter((i) => i.periodo === p).reduce((a, i) => a + Number(i.precio || 0) * Number(i.cantidad || 1), 0);
  const pct = tipo === "factura" ? ivaPct : 0;
  const mensual = suma("mensual");
  const unico = suma("unico");
  return { mensual, unico, iva_pct: pct, mensual_final: Math.round(mensual * (1 + pct / 100)), unico_final: Math.round(unico * (1 + pct / 100)) };
}
