// Facturación mensual de Prodi Redes (lógica pura: la usan el servidor, la app y la demo).
//
// El día 27 se prepara una boleta (o factura) por cliente con el abono del mes y los ítems fijos.
// Lucas la revisa, la emite y marca cuándo se cobró. Los clientes con débito automático quedan
// cobrados solos cuando Mercado Pago debita; los que pagaron por adelantado salen como cobrados.

export type TipoComprobante = "boleta" | "factura";
export type EstadoFactura = "borrador" | "pendiente" | "cobrada" | "anulada";
export type MedioCobro = "transferencia" | "efectivo" | "mercadopago" | "adelantado" | "debito" | "otro";

export interface ItemFactura {
  id: string;
  concepto: string;
  /** Como en la planilla: REDES (abono) o EXTRAS. */
  servicio: "REDES" | "EXTRAS";
  neto: number;
}

export interface Factura {
  proyecto_id: string;
  /** Período (YYYY-MM). */
  mes: string;
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
  estado: EstadoFactura;
  debito?: boolean;
  medio?: MedioCobro | null;
  cobrado_at?: string | null;
  nota?: string | null;
  creada_at: string;
  creada_por: string;
  emitida_at?: string | null;
  demo_ejemplo?: boolean;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMesF = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
};

export const facturaId = (proyectoId: string, mes: string) => `${proyectoId}_${mes}`;

/** Día `dia` del mes siguiente al período. */
export function vencimientoDe(mes: string, dia = 10): string {
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
  } | null;
  debitoActivo?: boolean;
  /** Mercado Pago ya debitó el abono de ese mes. */
  abonoDebitado?: boolean;
}

/** Arma el borrador de un cliente para el período. */
export function armarFactura(
  c: DatosCliente,
  mes: string,
  opciones: { ivaPct: number; diaVencimiento: number; por: string; hoy: string }
): Factura {
  const tipo: TipoComprobante = c.facturacion?.tipo === "factura" ? "factura" : "boleta";
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
  const t = totales(items, tipo, opciones.ivaPct);
  const adelantado = !!c.facturacion?.adelantado_hasta && mes <= c.facturacion.adelantado_hasta;
  const cobrada = adelantado || !!c.abonoDebitado;
  return {
    proyecto_id: c.id,
    mes,
    cliente: c.nombre,
    tipo,
    razon_social: c.facturacion?.razon_social ?? null,
    cuit: c.facturacion?.cuit ?? null,
    items,
    ...t,
    fecha: opciones.hoy,
    vencimiento: vencimientoDe(mes, opciones.diaVencimiento),
    estado: cobrada ? "cobrada" : "borrador",
    debito: !!c.debitoActivo,
    medio: adelantado ? "adelantado" : c.abonoDebitado ? "mercadopago" : null,
    cobrado_at: cobrada ? new Date().toISOString() : null,
    nota: adelantado
      ? `Pagado por adelantado hasta ${nombreMesF(c.facturacion!.adelantado_hasta!)}`
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
  return `Tu ${f.tipo === "factura" ? "factura" : "boleta"} de Prodi · ${nombreMesF(f.mes)}`;
}

/** Recordatorio de pago: mismo mail de la boleta con un aviso arriba. */
export function asuntoRecordatorio(f: Factura, vencida: boolean): string {
  const doc = f.tipo === "factura" ? "factura" : "boleta";
  return vencida ? `Recordatorio: tu ${doc} de ${nombreMesF(f.mes)} está vencida` : `Recordatorio: tu ${doc} de ${nombreMesF(f.mes)} vence pronto`;
}

export function mailFacturaHtml(f: Factura, link: string, baseUrl: string, aviso?: string): string {
  const doc = f.tipo === "factura" ? "factura" : "boleta";
  const filas = f.items
    .map(
      (i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #EEECF5;color:#111018;font-size:14px;">${escF(i.concepto)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #EEECF5;color:#111018;font-size:14px;text-align:right;white-space:nowrap;">${arsF(i.neto)}</td></tr>`
    )
    .join("");
  const vence = f.vencimiento.split("-").reverse().join("/");
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F2FA;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2FA;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:18px;overflow:hidden;">
<tr><td style="background:#0B0A10;padding:22px 28px;"><img src="${baseUrl}/brand/logo-horizontal-blanco.png" height="28" alt="PRODI" style="display:block;height:28px;"></td></tr>
<tr><td style="padding:28px;">
  ${aviso ? `<div style="background:#FFF4E5;border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:14px;color:#7A4B00;">${escF(aviso)}</div>` : ""}
  <div style="font-size:13px;color:#6B6880;">${escF(f.razon_social || f.cliente)}</div>
  <div style="font-size:22px;font-weight:700;color:#111018;margin:4px 0 2px;">Tu ${doc} de ${nombreMesF(f.mes)}</div>
  <div style="font-size:14px;color:#6B6880;">${f.debito ? "Se cobra solo por débito automático de Mercado Pago." : `Vence el ${vence}.`}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">${filas}
    ${f.iva ? `<tr><td style="padding:8px 0;color:#6B6880;font-size:13px;">IVA ${f.iva_pct}%</td><td style="padding:8px 0;color:#6B6880;font-size:13px;text-align:right;">${arsF(f.iva)}</td></tr>` : ""}
  </table>
  <div style="margin-top:16px;background:#6F40FC;border-radius:14px;padding:16px 18px;color:#FFFFFF;">
    <table role="presentation" width="100%"><tr><td style="font-size:15px;color:#FFFFFF;">Total</td><td style="font-size:22px;font-weight:700;color:#FFFFFF;text-align:right;">${arsF(f.bruto)}</td></tr></table>
  </div>
  <div style="text-align:center;margin:26px 0 8px;">
    <a href="${link}" style="display:inline-block;background:#111018;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:14px 26px;border-radius:12px;">Ver y descargar la ${doc}</a>
  </div>
  <div style="text-align:center;font-size:12px;color:#8A879A;">También la tenés en tu panel de Prodi, en “Mi plan”.</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #EEECF5;font-size:12px;color:#8A879A;">Este correo es un duplicado de la ${doc} que te dejamos en el sistema. Prodi · Reconquista, Santa Fe</td></tr>
</table></td></tr></table></body></html>`;
}
