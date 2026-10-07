import { DIA_PAGO_DESDE, diaPago } from "@/lib/redes/facturacion";

/** Lo que se guarda en `facturacion` (null = usa el de siempre: del 1 al día de Ajustes). */
export function plazoParaGuardar(desde: string, hasta: string, diaDefecto: number) {
  const h = diaPago(hasta);
  const d = diaPago(desde);
  const pago_hasta = h && h !== diaDefecto ? h : null;
  const pago_desde = d && d !== DIA_PAGO_DESDE ? d : null;
  return { pago_desde, pago_hasta };
}

/** El texto del input: vacío si no hay un día propio (se muestra el de siempre como placeholder). */
export const plazoInicial = (v: number | null | undefined) => (diaPago(v) ? String(v) : "");

/** Error a mostrar (o null) si el plazo no tiene sentido. */
export function errorPlazo(desde: string, hasta: string, diaDefecto: number): string | null {
  if ((desde && !diaPago(desde)) || (hasta && !diaPago(hasta))) return "Los días tienen que ir del 1 al 28.";
  const d = diaPago(desde) ?? DIA_PAGO_DESDE;
  const h = diaPago(hasta) ?? diaDefecto;
  return d > h ? "El primer día no puede ser después del último." : null;
}
