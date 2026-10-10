// Facturación mensual de Prodi Redes (lógica pura: la usan el servidor, la app y la demo).
//
// Calendario (mes vencido): el 27 de cada mes (M) se prepara una boleta (o factura) por cliente con el
// abono y los ítems fijos de ESE MES (el servicio de M). Se paga del 1 al 5 de M+1 (o hasta el día de
// Ajustes / el plazo propio del cliente); después corre un interés simple del 0,5% diario sobre el
// saldo (se calcula al vuelo, ver `interesMora`). Ej.: la armada el 27/10 es la "boleta de octubre" y
// se paga del 1 al 5 de noviembre.
// Lucas la revisa, la emite y marca cuándo se cobró. El débito automático de Mercado Pago cobra el
// total de la boleta (con IVA y extras fijos, ver `totalMensual`) más la comisión de Mercado Pago de
// Ajustes (`montoDebito`) y paga la última boleta pendiente; los que pagaron por adelantado salen como
// cobrados.
//
// Algunos clientes pagan a MES ADELANTADO (`facturacion.modo_cobro = "adelantado"`): la armada el 27/10
// es la "boleta de noviembre" (el servicio que viene) y se paga igual, del 1 al 5 de noviembre.
//
// `mes` es el mes en que se arma (el del 27; el id es `{cliente}_{mes}`). El período facturado queda
// guardado en `periodo` (ver `periodoFactura`); las boletas viejas sin `periodo` son de mes vencido.

export type TipoComprobante = "boleta" | "factura";
/** vencido: el 27 se factura ese mes. adelantado: el 27 se factura el mes que viene. */
export type ModoCobro = "vencido" | "adelantado";
export type EstadoFactura = "borrador" | "pendiente" | "cobrada" | "anulada";
export type MedioCobro = "transferencia" | "efectivo" | "cheque" | "mercadopago" | "adelantado" | "debito" | "otro";

/** Un pago a cuenta (el cliente paga la boleta en partes). */
export interface PagoParcial {
  monto: number;
  medio: MedioCobro;
  at: string;
  por?: string | null;
}

export interface ItemFactura {
  id: string;
  concepto: string;
  /** Como en la planilla: REDES (abono) o EXTRAS. */
  servicio: "REDES" | "EXTRAS";
  neto: number;
}

/** Lo que queda guardado en la factura cuando ARCA la autoriza (CAE). */
export interface DatosArca {
  cae: string;
  cae_vto: string;
  tipo: "A" | "B" | "C";
  cbte_tipo: number;
  punto_venta: number;
  numero: number;
  fecha: string;
  homologacion: boolean;
  autorizada_at: string;
  autorizada_por: string;
}

export interface Factura {
  proyecto_id: string;
  /** Mes en que se arma (el del 27, YYYY-MM). */
  mes: string;
  /** Mes del servicio que se factura (YYYY-MM): `mes` (vencido) o el siguiente (adelantado). */
  periodo?: string | null;
  cliente: string;
  tipo: TipoComprobante;
  razon_social?: string | null;
  cuit?: string | null;
  items: ItemFactura[];
  neto: number;
  iva_pct: number;
  iva: number;
  bruto: number;
  /** YYYY-MM-DD */
  fecha: string;
  vencimiento: string;
  /** Desde qué día del mes siguiente se puede pagar (por defecto el 1). El último día es `vencimiento`. */
  pago_desde?: number | null;
  estado: EstadoFactura;
  debito?: boolean;
  /**
   * Lo que ya debitó Mercado Pago. El débito cobra el total de la boleta, pero si la suscripción quedó
   * con un monto viejo (solo el abono neto, o un precio anterior) no alcanza y la diferencia queda
   * pendiente (ver `saldoDe`).
   */
  debitado?: number | null;
  /** De lo debitado, lo que se quedó Mercado Pago de comisión (no cuenta para pagar la boleta). */
  comision_mp?: number | null;
  medio?: MedioCobro | null;
  /** Pagos a cuenta (en partes). Cuando cubren el total, la boleta queda cobrada. */
  pagos?: PagoParcial[] | null;
  cobrado_at?: string | null;
  /** Interés por mora que se cobró al marcarla cobrada (queda fijo para el historial). */
  interes_cobrado?: number | null;
  nota?: string | null;
  creada_at: string;
  creada_por: string;
  emitida_at?: string | null;
  /** Se cambiaron los ítems a mano ("Editar"): ya no sigue sola el abono del cliente. */
  editada_a_mano?: boolean;
  /** Quién se la mandó al cliente (al emitir). Si falta, nunca se le mandó (p. ej. se marcó "ya pagó" sin emitir). */
  emitida_por?: string | null;
  /** Factura electrónica autorizada en ARCA (solo las de tipo "factura"). Lo escribe el servidor. */
  arca?: DatosArca | null;
  /** Último rechazo de ARCA, para mostrarlo. */
  arca_error?: string | null;
  demo_ejemplo?: boolean;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMesF = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
};

export const facturaId = (proyectoId: string, mes: string) => `${proyectoId}_${mes}`;

/** Día del mes siguiente al facturado en que vence la boleta, si no hay otro en Ajustes. */
export const DIA_VENCIMIENTO = 5;
/** Desde qué día del mes siguiente se paga, si el cliente no tiene otro (se paga del 1 al 5). */
export const DIA_PAGO_DESDE = 1;

/** Un día de pago válido (1 a 28, para que exista en todos los meses) o null. */
export const diaPago = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return v != null && v !== "" && n >= 1 && n <= 28 ? n : null;
};
/** Interés por mora: 0,5% diario, simple, sobre el saldo. */
export const TASA_INTERES_DIARIO = 0.005;

/**
 * Período que cubre una boleta armada el 27 de `mes`: ese mismo mes (mes vencido, lo normal) o el
 * siguiente (mes adelantado).
 */
export function periodoDe(mes: string, modo: ModoCobro | null = "vencido"): string {
  if (modo !== "adelantado") return mes;
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Mes del servicio de una boleta (las viejas, sin `periodo`, son de mes vencido). */
export const periodoFactura = (f: Pick<Factura, "mes" | "periodo">) => f.periodo || f.mes;

/** "octubre 2026": el período de la boleta (el mes del servicio). */
export const nombrePeriodo = (f: Pick<Factura, "mes" | "periodo">) => nombreMesF(periodoFactura(f));

/** Día `dia` del mes siguiente a `mes`: la boleta de octubre vence el 5 de noviembre. */
export function vencimientoDe(mes: string, dia = DIA_VENCIMIENTO): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, Math.min(28, Math.max(1, dia))));
  return d.toISOString().slice(0, 10);
}

export function totales(items: ItemFactura[], tipo: TipoComprobante, ivaPct: number) {
  const neto = Math.round(items.reduce((a, i) => a + (Number(i.neto) || 0), 0));
  const pct = tipo === "factura" ? ivaPct : 0;
  const iva = Math.round((neto * pct) / 100);
  return { neto, iva_pct: pct, iva, bruto: neto + iva };
}

/** Lo que falta cobrar de una boleta (el total menos lo que ya debitó Mercado Pago, sin su comisión). */
/** Lo que ya pagó a cuenta (pagos parciales). */
export const pagadoDe = (f: Pick<Factura, "pagos">) => (f.pagos ?? []).reduce((a, p) => a + (Number(p?.monto) || 0), 0);

/** Lo que falta pagar: el total menos lo debitado (sin la comisión de MP) y lo pagado a cuenta. */
export const saldoDe = (f: Pick<Factura, "bruto" | "debitado" | "comision_mp" | "pagos">) =>
  Math.max(0, Math.round(Number(f.bruto) - Number(f.debitado ?? 0) + Number(f.comision_mp ?? 0) - pagadoDe(f)));

/** Ya se pagó una parte (débito que no alcanzó o pagos a cuenta): se avisa el saldo en vez del total. */
export const pagoUnaParte = (f: Pick<Factura, "debitado" | "pagos">) => !!(f.debitado || f.pagos?.length);

/** Comisión de Mercado Pago válida (más de 0 y menos de 50%, IVA incluido) o 0. */
export const comisionPct = (v: unknown) => {
  const n = Number(v);
  return n > 0 && n < 50 ? n : 0;
};

/**
 * Lo que tiene que debitar Mercado Pago para que, después de su comisión (`pct`% de lo cobrado), a
 * PRODI le quede el total de la boleta: total / (1 − pct/100), en pesos enteros.
 */
export const montoDebito = (total: number, pct: number) => {
  const p = comisionPct(pct);
  return p ? Math.round(total / (1 - p / 100)) : total;
};

/** Lo que se queda Mercado Pago de un débito de `monto` (con centavos). */
export const comisionDe = (monto: number, pct: number) => Math.round(monto * comisionPct(pct)) / 100;

/** Un débito "cubre" la boleta si llega al total (con medio peso de redondeo). */
export const debitoCubre = (debitado: number, bruto: number) => debitado > 0 && debitado + 0.5 >= bruto;

export const notaDebitoParcial = (debitado: number, saldo: number) =>
  `Mercado Pago debitó ${arsF(debitado)}. Falta cobrar ${arsF(saldo)} (el débito tiene un monto menor al total: revisalo).`;

/** Días de calendario de `desde` a `hasta` (YYYY-MM-DD). */
const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);

/**
 * Interés por mora de una boleta pendiente a la fecha `hoy` (YYYY-MM-DD, en Argentina): 0,5% diario
 * simple sobre el saldo, contando cada día desde el siguiente al vencimiento (el 6, si vence el 5)
 * hasta `hoy` inclusive. No se guarda en la boleta: se calcula siempre al vuelo. Al cobrarla se
 * guarda lo que se cobró en `interes_cobrado`.
 */
export function interesMora(
  f: Pick<Factura, "estado" | "bruto" | "debitado" | "comision_mp" | "pagos" | "vencimiento">,
  hoy: string
): { dias: number; saldo: number; interes: number; totalConInteres: number } {
  const saldo = saldoDe(f);
  const dias = f.estado === "pendiente" && saldo > 0 && f.vencimiento ? Math.max(0, diasEntre(f.vencimiento, hoy)) : 0;
  const interes = Math.round(saldo * TASA_INTERES_DIARIO * dias);
  return { dias, saldo, interes, totalConInteres: saldo + interes };
}

/** "Vencida hace 3 días · interés $1.500 · total $101.500" (vacío si no está vencida). */
export function textoMora(f: Pick<Factura, "estado" | "bruto" | "debitado" | "comision_mp" | "pagos" | "vencimiento">, hoy: string): string {
  const m = interesMora(f, hoy);
  if (!m.dias) return "";
  return `Vencida hace ${m.dias} día${m.dias === 1 ? "" : "s"} · interés ${arsF(m.interes)} · total ${arsF(m.totalConInteres)}`;
}

/** Leyenda del vencimiento y el interés (boletas, mails y avisos). */
export const leyendaInteres = (vencimiento: string, desde?: number | null) =>
  `${textoPlazoPago(vencimiento, desde)}. Después corre un interés del 0,5% por día.`;

/** "Se paga del 01/11 al 05/11" (o "Vence el 05/11" si el plazo es de un solo día). */
export function textoPlazoPago(vencimiento: string, desde?: number | null): string {
  const [, m, d] = vencimiento.split("-");
  const ini = diaPago(desde) ?? DIA_PAGO_DESDE;
  if (ini >= Number(d)) return `Vence el ${d}/${m}`;
  return `Se paga del ${String(ini).padStart(2, "0")}/${m} al ${d}/${m}`;
}

export interface DatosCliente {
  id: string;
  nombre: string;
  /** Abono del mes (neto). */
  abono: number;
  planNombre?: string | null;
  videosMes?: number | null;
  facturacion?: {
    tipo?: TipoComprobante;
    razon_social?: string | null;
    cuit?: string | null;
    extras_fijos?: { concepto: string; neto: number }[];
    adelantado_hasta?: string | null;
    /** Días del mes siguiente en que paga (por defecto del 1 al día de vencimiento de Ajustes, el 5). */
    pago_desde?: number | null;
    pago_hasta?: number | null;
    /** vencido (por defecto): el 27 se factura ese mes. adelantado: el 27 se factura el mes que viene. */
    modo_cobro?: "vencido" | "adelantado" | null;
  } | null;
  debitoActivo?: boolean;
  /** Mercado Pago ya debitó y ese débito todavía no se aplicó a ninguna boleta. */
  abonoDebitado?: boolean;
  /** Cuánto debitó (si no viene, se toma como que cubrió todo). */
  montoDebitado?: number | null;
  /** De eso, cuánto se quedó Mercado Pago de comisión. */
  comisionDebitada?: number | null;
}

type DatosMonto = Pick<DatosCliente, "abono" | "facturacion">;

// Por defecto factura (con IVA, se autoriza en ARCA); boleta solo si el cliente lo tiene elegido.
const tipoDe = (c: DatosMonto): TipoComprobante => (c.facturacion?.tipo === "boleta" ? "boleta" : "factura");

/** Ítems de la boleta mensual: el abono y los extras fijos. */
export function itemsDe(c: DatosMonto): ItemFactura[] {
  const items: ItemFactura[] = [];
  if (c.abono > 0) {
    items.push({
      id: "abono",
      concepto: "Gestión de redes sociales",
      servicio: "REDES",
      neto: c.abono,
    });
  }
  (c.facturacion?.extras_fijos ?? []).forEach((x, i) => {
    if (x.concepto && Number(x.neto) > 0) items.push({ id: `fijo${i}`, concepto: x.concepto, servicio: "EXTRAS", neto: Number(x.neto) });
  });
  return items;
}

/**
 * Total del mes con IVA y extras fijos: lo mismo que da la boleta (`armarFactura`). El débito
 * automático cobra esto más la comisión de Mercado Pago (`montoDebito`), así a PRODI le queda la boleta.
 */
export const totalMensual = (c: DatosMonto, ivaPct: number) => totales(itemsDe(c), tipoDe(c), ivaPct).bruto;

/** Arma el borrador de un cliente: se arma el 27 de `mes`, cubre ese mes y se paga en el siguiente. */
export function armarFactura(
  c: DatosCliente,
  mes: string,
  opciones: { ivaPct: number; diaVencimiento: number; por: string; hoy: string }
): Factura {
  const tipo = tipoDe(c);
  const items = itemsDe(c);
  const t = totales(items, tipo, opciones.ivaPct);
  const periodo = periodoDe(mes, c.facturacion?.modo_cobro ?? "vencido");
  // "Tiene pagado hasta" es un mes de servicio: se compara con el período de la boleta.
  const adelantado = !!c.facturacion?.adelantado_hasta && periodo <= c.facturacion.adelantado_hasta;
  // Si el débito no llega al total (suscripción con un monto viejo), el resto queda para cobrar.
  // La comisión de Mercado Pago no paga la boleta.
  const debitado = c.abonoDebitado ? Math.round(Number(c.montoDebitado ?? t.bruto) || 0) : 0;
  const comision = debitado > 0 ? Math.max(0, Number(c.comisionDebitada ?? 0) || 0) : 0;
  const cubre = debitoCubre(debitado - comision, t.bruto);
  const parcial = !adelantado && debitado > 0 && !cubre;
  const cobrada = adelantado || cubre;
  return {
    proyecto_id: c.id,
    mes,
    periodo,
    cliente: c.nombre,
    tipo,
    razon_social: c.facturacion?.razon_social ?? null,
    cuit: c.facturacion?.cuit ?? null,
    items,
    ...t,
    fecha: opciones.hoy,
    // Se paga el mes siguiente: del 1 al día de Ajustes (el 5), o en el plazo propio del cliente.
    vencimiento: vencimientoDe(mes, diaPago(c.facturacion?.pago_hasta) ?? opciones.diaVencimiento),
    pago_desde: diaPago(c.facturacion?.pago_desde) ?? DIA_PAGO_DESDE,
    estado: cobrada ? "cobrada" : "borrador",
    debito: !!c.debitoActivo,
    ...(debitado > 0 && !adelantado ? { debitado, ...(comision ? { comision_mp: comision } : {}) } : {}),
    medio: adelantado ? "adelantado" : cubre ? "mercadopago" : null,
    cobrado_at: cobrada ? new Date().toISOString() : null,
    ...(cobrada ? { interes_cobrado: 0 } : {}),
    nota: adelantado
      ? `Pagado por adelantado hasta ${nombreMesF(c.facturacion!.adelantado_hasta!)}`
      : parcial
        ? notaDebitoParcial(debitado, saldoDe({ bruto: t.bruto, debitado, comision_mp: comision }))
        : c.debitoActivo
        ? "Se cobra solo por débito automático de Mercado Pago"
        : null,
    creada_at: new Date().toISOString(),
    creada_por: opciones.por,
  };
}

/** Columnas de la planilla de cobros (las mismas que usa la administración). */
export const COLUMNAS_PLANILLA = ["CLIENTES", "COBRO", "SERVICIO", "FECHA", "VTO DEL PAGO", "MONTO NETO", "IVA", "MONTO BRUTO", "BOLETA/FACTURA"];

const ddmmyyyy = (f: string) => f.split("-").reverse().join("/");

export function filasPlanilla(f: Factura): string[][] {
  const cobro = f.estado === "cobrada" ? (f.medio === "adelantado" ? "ADELANTADO" : "COBRADO") : f.estado === "anulada" ? "ANULADA" : "PENDIENTE";
  return f.items.map((i) => {
    const pct = f.tipo === "factura" ? f.iva_pct : 0;
    const iva = Math.round((i.neto * pct) / 100);
    return [
      f.cliente,
      cobro,
      i.servicio,
      ddmmyyyy(f.fecha),
      ddmmyyyy(f.vencimiento),
      String(i.neto),
      String(iva),
      String(i.neto + iva),
      f.tipo === "factura" ? "FACTURA" : "BOLETA",
    ];
  });
}

/** CSV para Excel en español (separado por punto y coma). */
export function planillaCSV(facturas: Factura[]): string {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const filas = [COLUMNAS_PLANILLA, ...facturas.filter((f) => f.estado !== "anulada").flatMap(filasPlanilla)];
  return "﻿" + filas.map((r) => r.map(esc).join(";")).join("\r\n");
}

// ---------------------------------------------------------------------------
// Correo al emitir: duplicado de la boleta con el botón para verla en el sistema
// ---------------------------------------------------------------------------

const arsF = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);
const escF = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function asuntoFactura(f: Factura): string {
  return `Tu ${f.tipo === "factura" ? "factura" : "boleta"} de Prodi · ${nombrePeriodo(f)}`;
}

/** Recordatorio de pago: mismo mail de la boleta con un aviso arriba. */
export function asuntoRecordatorio(f: Factura, vencida: boolean): string {
  const doc = f.tipo === "factura" ? "factura" : "boleta";
  return vencida ? `Recordatorio: tu ${doc} de ${nombrePeriodo(f)} está vencida` : `Recordatorio: tu ${doc} de ${nombrePeriodo(f)} vence pronto`;
}

/** Con `hoy` (YYYY-MM-DD, Argentina) y la boleta vencida, el mail suma el interés a esa fecha. */
export function mailFacturaHtml(f: Factura, link: string, baseUrl: string, aviso?: string, hoy?: string): string {
  const doc = f.tipo === "factura" ? "factura" : "boleta";
  const filas = f.items
    .map(
      (i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #EEECF5;color:#111018;font-size:14px;">${escF(i.concepto)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #EEECF5;color:#111018;font-size:14px;text-align:right;white-space:nowrap;">${arsF(i.neto)}</td></tr>`
    )
    .join("");
  // Débito parcial (el débito no llegó al total): se avisa cuánto falta pagar.
  const saldo = pagoUnaParte(f) ? saldoDe(f) : 0;
  const mora = hoy ? interesMora(f, hoy) : null;
  const bajada =
    f.pagos?.length && saldo > 0
      ? `Ya pagaste ${arsF(pagadoDe(f))}. Falta pagar ${arsF(saldo)}. ${leyendaInteres(f.vencimiento, f.pago_desde)}`
      : f.debitado && saldo > 0
      ? `Mercado Pago ya debitó ${arsF(f.debitado)}${f.comision_mp ? ` (con ${arsF(f.comision_mp)} de comisión)` : ""}. Falta pagar ${arsF(saldo)}. ${leyendaInteres(f.vencimiento, f.pago_desde)}`
      : f.debito
        ? "Se cobra solo por débito automático de Mercado Pago."
        : leyendaInteres(f.vencimiento, f.pago_desde);
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F2FA;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2FA;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:18px;overflow:hidden;">
<tr><td style="background:#0B0A10;padding:22px 28px;"><img src="${baseUrl}/brand/logo-horizontal-blanco.png" height="28" alt="PRODI" style="display:block;height:28px;"></td></tr>
<tr><td style="padding:28px;">
  ${aviso ? `<div style="background:#FFF4E5;border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:14px;color:#7A4B00;">${escF(aviso)}</div>` : ""}
  <div style="font-size:13px;color:#6B6880;">${escF(f.razon_social || f.cliente)}</div>
  <div style="font-size:22px;font-weight:700;color:#111018;margin:4px 0 2px;">Tu ${doc} de ${nombrePeriodo(f)}</div>
  <div style="font-size:14px;color:#6B6880;">${escF(bajada)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">${filas}
    ${f.iva ? `<tr><td style="padding:8px 0;color:#6B6880;font-size:13px;">IVA ${f.iva_pct}%</td><td style="padding:8px 0;color:#6B6880;font-size:13px;text-align:right;">${arsF(f.iva)}</td></tr>` : ""}
  </table>
  <div style="margin-top:16px;background:#6F40FC;border-radius:14px;padding:16px 18px;color:#FFFFFF;">
    <table role="presentation" width="100%"><tr><td style="font-size:15px;color:#FFFFFF;">Total</td><td style="font-size:22px;font-weight:700;color:#FFFFFF;text-align:right;">${arsF(f.bruto)}</td></tr>${
      saldo > 0
        ? `<tr><td style="font-size:13px;color:#FFFFFF;padding-top:6px;">Debitado por Mercado Pago</td><td style="font-size:13px;color:#FFFFFF;text-align:right;padding-top:6px;">−${arsF(f.debitado ?? 0)}</td></tr>
    <tr><td style="font-size:15px;font-weight:700;color:#FFFFFF;padding-top:6px;">Falta pagar</td><td style="font-size:18px;font-weight:700;color:#FFFFFF;text-align:right;padding-top:6px;">${arsF(saldo)}</td></tr>`
        : ""
    }${
      mora?.dias
        ? `<tr><td style="font-size:13px;color:#FFFFFF;padding-top:6px;">Interés por mora (${mora.dias} día${mora.dias === 1 ? "" : "s"} al 0,5%)</td><td style="font-size:13px;color:#FFFFFF;text-align:right;padding-top:6px;">+${arsF(mora.interes)}</td></tr>
    <tr><td style="font-size:15px;font-weight:700;color:#FFFFFF;padding-top:6px;">Total a pagar hoy</td><td style="font-size:18px;font-weight:700;color:#FFFFFF;text-align:right;padding-top:6px;">${arsF(mora.totalConInteres)}</td></tr>`
        : ""
    }</table>
  </div>
  <div style="text-align:center;margin:26px 0 8px;">
    <a href="${link}" style="display:inline-block;background:#111018;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:14px 26px;border-radius:12px;">Ver y descargar la ${doc}</a>
  </div>
  <div style="text-align:center;font-size:12px;color:#8A879A;">También la tenés en tu panel de Prodi, en “Mi plan”.</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #EEECF5;font-size:12px;color:#8A879A;">Este correo es un duplicado de la ${doc} que te dejamos en el sistema. Prodi · Reconquista, Santa Fe</td></tr>
</table></td></tr></table></body></html>`;
}
