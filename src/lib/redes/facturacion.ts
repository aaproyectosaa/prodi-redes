// Facturación del 27 y pagos al equipo (solo super admin).
import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { callApi } from "@/lib/redes/api";
import { assertEditable } from "@/lib/redes/vistaComo";
import { avisar, equipoDe } from "./avisos";
import type { Project } from "@/integrations/firebase/types";
import { toast } from "sonner";
import { asset } from "@/lib/asset";
import { fechaAR, hoyAR, mesAR } from "@/lib/fecha";
import type { DatosCobro, PiezaIA, Video } from "./types";
import {
  interesMora,
  leyendaInteres,
  nombrePeriodo,
  planillaCSV,
  textoMora,
  totales,
  type EstadoFactura,
  type Factura,
  type ItemFactura,
  type MedioCobro,
} from "../../../api/_lib/facturacion";

export type { EstadoFactura, Factura, ItemFactura, MedioCobro };
export type { ModoCobro } from "../../../api/_lib/facturacion";
// Las reglas de facturación son las mismas que usa el servidor (mismo archivo): período (el 27 se
// arma la de ese mes, mes vencido), se paga del 1 al 5 del siguiente, interés del 0,5% diario y total
// del débito (con la comisión de Mercado Pago).
export {
  DIA_PAGO_DESDE,
  DIA_VENCIMIENTO,
  comisionDe,
  comisionPct,
  diaPago,
  interesMora,
  leyendaInteres,
  montoDebito,
  nombrePeriodo,
  periodoDe,
  periodoFactura,
  saldoDe,
  textoMora,
  textoPlazoPago,
  totalMensual,
} from "../../../api/_lib/facturacion";
export type FacturaDoc = Factura & { id: string };

export const ESTADO_FACTURA: Record<EstadoFactura, { label: string; clase: string }> = {
  borrador: { label: "Para revisar", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  pendiente: { label: "Falta cobrar", clase: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  cobrada: { label: "Cobrada", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  anulada: { label: "Anulada", clase: "bg-muted text-muted-foreground line-through" },
};

export const MEDIOS: { value: MedioCobro; label: string }[] = [
  { value: "transferencia", label: "Transferencia" },
  { value: "efectivo", label: "Efectivo" },
  { value: "mercadopago", label: "Mercado Pago" },
  { value: "adelantado", label: "Pagado por adelantado" },
  { value: "otro", label: "Otro" },
];

/** Cómo se pagó una cuota o un impuesto. */
export const MEDIOS_PAGO: { value: MedioCobro; label: string }[] = [
  { value: "transferencia", label: "Transferencia" },
  { value: "debito", label: "Débito automático" },
  { value: "efectivo", label: "Efectivo" },
  { value: "otro", label: "Otro (VEP, tarjeta…)" },
];

/** Facturas desde un mes en adelante (para el tablero y la facturación). */
export function useFacturas(desdeMes: string, enabled = true): { facturas: FacturaDoc[]; loading: boolean } {
  const [facturas, setFacturas] = useState<FacturaDoc[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) {
      setFacturas([]);
      setLoading(false);
      return;
    }
    return onSnapshot(
      query(collection(db, "facturas"), where("mes", ">=", desdeMes)),
      (s) => {
        setFacturas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as FacturaDoc));
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [desdeMes, enabled]);
  return { facturas, loading };
}

/** Boletas emitidas de un cliente (las ve en "Mi plan"). */
export function useFacturasCliente(proyectoId: string | undefined): FacturaDoc[] {
  const [lista, setLista] = useState<FacturaDoc[]>([]);
  useEffect(() => {
    if (!proyectoId) return;
    return onSnapshot(
      query(collection(db, "facturas"), where("proyecto_id", "==", proyectoId), where("estado", "in", ["pendiente", "cobrada"])),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...d.data() }) as FacturaDoc).sort((a, b) => b.mes.localeCompare(a.mes))),
      () => setLista([])
    );
  }, [proyectoId]);
  return lista;
}

/** Prepara las boletas del mes. Con `proyectoIds`, solo para esos clientes (aunque no tengan plan). */
export const prepararFacturacion = (mes: string, proyectoIds?: string[]) =>
  callApi<{ ok: true; creadas: number; existentes: number }>("/api/pagos/facturar", { mes, proyecto_ids: proyectoIds ?? null });

type ResultadoEmitir = { ok: true; emitidas: number; mails: number; sin_mail: string[]; falla_mail?: string[] };

/** Emite a los clientes elegidos: arma la boleta si todavía no estaba y se la manda (panel + mail). */
export const emitirAClientes = (mes: string, proyectoIds: string[]) =>
  callApi<ResultadoEmitir>("/api/pagos/emitir", { mes, proyecto_ids: proyectoIds });

/** Datos de facturación del cliente (los usa la boleta del 27). */
export async function guardarDatosFacturacion(proyectoId: string, facturacion: NonNullable<Project["facturacion"]>) {
  assertEditable();
  await updateDoc(doc(db, "projects", proyectoId), { facturacion });
}

/** Cambia ítems o tipo y recalcula los totales. */
export async function editarFactura(f: FacturaDoc, cambios: { items?: ItemFactura[]; tipo?: Factura["tipo"]; vencimiento?: string; nota?: string | null }, ivaPct: number) {
  assertEditable();
  const items = cambios.items ?? f.items;
  const tipo = cambios.tipo ?? f.tipo;
  await updateDoc(doc(db, "facturas", f.id), {
    items,
    tipo,
    ...totales(items, tipo, ivaPct),
    ...(cambios.vencimiento ? { vencimiento: cambios.vencimiento } : {}),
    ...(cambios.nota !== undefined ? { nota: cambios.nota } : {}),
  });
}

/** Emitir: queda "falta cobrar", el cliente la ve en su panel, le llega el aviso y un duplicado por correo. */
export async function emitirFacturas(lista: FacturaDoc[], _clientes?: Project[]) {
  assertEditable();
  const ids = lista.filter((x) => x.estado === "borrador").map((x) => x.id);
  if (!ids.length) return { emitidas: 0, mails: 0, sin_mail: [] as string[] };
  return callApi<{ ok: true; emitidas: number; mails: number; sin_mail: string[] }>("/api/pagos/emitir", { ids });
}

/** Pide el CAE en ARCA (solo facturas emitidas). `reintentar` si un intento anterior quedó a medias. */
export async function autorizarEnArca(f: FacturaDoc, reintentar = false) {
  assertEditable();
  return callApi<{ ok: true; arca: NonNullable<Factura["arca"]> }>("/api/pagos/arca-autorizar", { factura_id: f.id, reintentar });
}

/** "Factura A 0003-00000012" */
export const numeroArca = (a: NonNullable<Factura["arca"]>) =>
  `Factura ${a.tipo} ${String(a.punto_venta).padStart(4, "0")}-${String(a.numero).padStart(8, "0")}`;

/** Queda cobrada con el interés por mora de hoy (se guarda fijo en `interes_cobrado`). */
export async function marcarCobrada(f: FacturaDoc, medio: MedioCobro) {
  assertEditable();
  await updateDoc(doc(db, "facturas", f.id), {
    estado: "cobrada",
    medio,
    cobrado_at: new Date().toISOString(),
    emitida_at: f.emitida_at ?? new Date().toISOString(),
    interes_cobrado: interesMora(f, hoyAR()).interes,
  });
}

export async function volverAPendiente(f: FacturaDoc) {
  assertEditable();
  await updateDoc(doc(db, "facturas", f.id), { estado: "pendiente", medio: null, cobrado_at: null, interes_cobrado: null });
}

/** Una que estaba en "no facturar" vuelve a revisión. */
export async function reactivarFactura(f: FacturaDoc) {
  assertEditable();
  await updateDoc(doc(db, "facturas", f.id), { estado: "borrador" });
}

export async function anularFactura(f: FacturaDoc) {
  assertEditable();
  await updateDoc(doc(db, "facturas", f.id), { estado: "anulada" });
}

export function descargarPlanilla(lista: Factura[], mes: string) {
  const blob = new Blob([planillaCSV(lista)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cobros-${mes}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const ars = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fecha = (f: string) => f.split("-").reverse().join("/");

/** Texto del recordatorio de pago (para copiar y mandar por el chat o por mail). */
export function textoCobro(f: Factura, cobro: DatosCobro): string {
  const mora = interesMora(f, hoyAR());
  return [
    `Hola! Te paso la ${f.tipo === "factura" ? "factura" : "boleta"} de Prodi de ${nombrePeriodo(f)}.`,
    ...f.items.map((i) => `• ${i.concepto}: ${ars(i.neto)}`),
    f.iva ? `IVA ${f.iva_pct}%: ${ars(f.iva)}` : "",
    `Total: ${ars(f.bruto)} · vence el ${fecha(f.vencimiento)}`,
    mora.dias
      ? `Venció hace ${mora.dias} día${mora.dias === 1 ? "" : "s"}: con el interés (0,5% por día) hoy son ${ars(mora.totalConInteres)}.`
      : "Después del vencimiento corre un interés del 0,5% por día.",
    f.debito ? "Se debita solo con Mercado Pago 👌" : `Podés transferir al alias ${cobro.alias} (${cobro.banco}, a nombre de ${cobro.titular}). Mandanos el comprobante por el chat de Prodi${cobro.email ? ` o a ${cobro.email}` : ""}. ¡Gracias!`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Boleta con la marca PRODI, fondo blanco (para imprimir o guardar como PDF). */
/** Una o varias boletas en un solo documento (una por hoja) para imprimir o guardar en PDF. */
export function htmlBoletas(lista: Factura[], cobro: DatosCobro, logoUrl: string, imprimir = true): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const f0 = lista[0];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${lista.length === 1 ? `${f0.tipo === "factura" ? "Factura" : "Boleta"} ${esc(f0.cliente)}` : `${lista.length} boletas`} · ${nombrePeriodo(f0)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#1a1724;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.pag{max-width:760px;margin:0 auto;padding:40px 44px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:3px solid #6F40FC;padding-bottom:18px}
header img{height:40px}.emp{font-size:12px;color:#706d80;text-align:right}.emp b{color:#1a1724;font-size:14px}
h1{font-size:22px;margin:26px 0 4px}.sub{color:#706d80;margin:0 0 22px}
.sec{display:flex;gap:10px;align-items:center;margin:22px 0 8px;font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6F40FC}
.sec span{background:#6F40FC;color:#fff;border-radius:6px;padding:2px 7px;font-size:11px}
.panel{background:#f4f2fa;border-radius:12px;padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}
.panel div small{display:block;color:#706d80;font-size:11px}
table{width:100%;border-collapse:collapse}th{background:#2A1860;color:#fff;text-align:left;font-size:12px;padding:9px 12px}
td{padding:10px 12px;border-bottom:1px solid #d3d0dc}.r{text-align:right;white-space:nowrap}
.tot td{border:0;padding:5px 12px;color:#706d80}.total{margin-top:10px;background:#6F40FC;color:#fff;border-radius:12px;padding:14px 18px;display:flex;justify-content:space-between;font-size:18px;font-weight:700}
.obs{font-size:12px;color:#706d80;margin:6px 0}footer{margin-top:34px;border-top:1px solid #d3d0dc;padding-top:12px;font-size:12px;color:#706d80;display:flex;justify-content:space-between}
.sello{display:inline-block;border:2px solid #16a34a;color:#16a34a;border-radius:8px;padding:2px 10px;font-weight:700;font-size:12px;margin-left:8px;vertical-align:middle}
@media print{.pag{padding:18px}}
.pag+.pag{page-break-before:always;border-top:1px dashed #d3d0dc}
</style></head><body>${lista.map((f) => {
  const filas = f.items.map((i) => `<tr><td>${esc(i.concepto)}</td><td class="r">${ars(i.neto)}</td></tr>`).join("");
  return `<div class="pag">
<header><img src="${logoUrl}" alt="PRODI"><div class="emp"><b>PRODI – Progreso Digital</b><br>Área administrativa · División Redes<br>Reconquista, Santa Fe</div></header>
<h1>${f.tipo === "factura" ? "Detalle de factura" : "Boleta de pago"}${f.estado === "cobrada" ? '<span class="sello">PAGADA</span>' : ""}</h1>
<p class="sub">Período ${nombrePeriodo(f)}</p>
<div class="sec"><span>01</span> Cliente</div>
<div class="panel"><div><small>Cliente</small>${esc(f.razon_social || f.cliente)}</div><div><small>CUIT</small>${esc(f.cuit || "—")}</div>
<div><small>Fecha</small>${fecha(f.fecha)}</div><div><small>Vence</small>${fecha(f.vencimiento)}</div></div>
<div class="sec"><span>02</span> Detalle</div>
<table><thead><tr><th>Concepto</th><th class="r">Importe</th></tr></thead><tbody>${filas}</tbody>
<tbody class="tot"><tr><td class="r">Subtotal</td><td class="r">${ars(f.neto)}</td></tr>${f.iva ? `<tr><td class="r">IVA ${f.iva_pct}%</td><td class="r">${ars(f.iva)}</td></tr>` : ""}</tbody></table>
<div class="total"><span>Total</span><span>${ars(f.bruto)}</span></div>
<div class="sec"><span>03</span> Cómo pagar</div>
${
    f.debito
      ? `<p>Se cobra solo por débito automático de Mercado Pago.</p>`
      : `<div class="panel"><div><small>Titular</small>${esc(cobro.titular)}</div><div><small>CUIT</small>${esc(cobro.cuit)}</div>
<div><small>Banco</small>${esc(cobro.banco)}</div><div><small>Alias</small><b>${esc(cobro.alias)}</b></div><div style="grid-column:1/-1"><small>CBU</small>${esc(cobro.cbu)}</div></div>`
  }
${f.debito || f.estado === "cobrada" ? "" : `<p class="obs">Enviá el comprobante de transferencia por el chat de Prodi${cobro.email ? ` o a ${esc(cobro.email)}` : ""} para registrar el pago.</p>`}
${
    f.estado === "cobrada"
      ? f.interes_cobrado
        ? `<p class="obs">Se cobró además ${ars(f.interes_cobrado)} de interés por mora.</p>`
        : ""
      : `<p class="obs">${esc(leyendaInteres(f.vencimiento, f.pago_desde))}</p>${textoMora(f, hoyAR()) ? `<p class="obs"><b>${esc(textoMora(f, hoyAR()))}</b></p>` : ""}`
  }
${f.tipo === "boleta" ? '<p class="obs">Este documento es una boleta de pago y no reemplaza la factura correspondiente.</p>' : ""}
${f.nota && !(f.debito && f.nota.startsWith("Se cobra solo")) ? `<p class="obs">${esc(f.nota)}</p>` : ""}
<footer><span>Progreso Digital para tu negocio</span><span>${cobro.email ? `Comprobantes: ${esc(cobro.email)}` : ""}</span></footer>
</div>`;
}).join("")}${imprimir ? "<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>" : ""}</body></html>`;
}

export function htmlBoleta(f: Factura, cobro: DatosCobro, logoUrl: string): string {
  return htmlBoletas([f], cobro, logoUrl);
}

// ---------------------------------------------------------------------------
// Pagos al equipo
// ---------------------------------------------------------------------------

export type ModoPago = "fijo" | "por_unidad" | "mixto" | "por_cliente";

export interface ConfigPago {
  modo: ModoPago;
  /** Monto fijo por mes (en "por cliente" es opcional y se suma). */
  fijo: number;
  /** Monto por cada unidad de trabajo (video editado, filmado, publicado o pieza entregada). */
  por_unidad: number;
  /** Por cliente: cuánto se le paga por cada cliente que lleva (cada uno editable). */
  por_cliente?: Record<string, number>;
  activo?: boolean;
}

/** Clientes que una persona tiene asignados (para sugerir el pago por cliente). */
export function clientesDe(uid: string, clientes: Project[]): Project[] {
  return clientes.filter((c) => Object.values(c.team_roles ?? {}).some((l) => Array.isArray(l) && l.includes(uid)));
}

export interface AjustePago {
  concepto: string;
  monto: number;
}

export interface Liquidacion {
  id: string;
  uid: string;
  mes: string;
  ajustes: AjustePago[];
  estado: "pendiente" | "pagado";
  pagado_at?: string | null;
  total_pagado?: number | null;
  detalle?: string | null;
}

export const UNIDAD_POR_ROL: Record<string, { label: string; plural: string }> = {
  productor: { label: "video filmado", plural: "videos filmados" },
  editor: { label: "video editado", plural: "videos editados" },
  pauta: { label: "video publicado", plural: "videos publicados" },
  diseno: { label: "pieza entregada", plural: "piezas entregadas" },
};

/** Un trabajo que cuenta para el pago del mes: un video o una pieza, con cuándo se hizo. */
export interface TrabajoDelMes {
  id: string;
  titulo: string;
  proyecto_id: string;
  at: string;
  tipo: "video" | "pieza";
}

/**
 * Lo que hizo cada persona en el mes (sale del historial): la productora, el crudo cargado; la editora,
 * la edición entregada; pauta, lo publicado; diseño, las piezas que aprobó el cliente.
 */
export function trabajosDelMes(uid: string, role: string, mes: string, videos: Video[], piezas: PiezaIA[]): TrabajoDelMes[] {
  const en = (at: string) => mesAR(at) === mes;
  if (role === "diseno") {
    return piezas.flatMap((p) => {
      const aprobada = (p.historial ?? []).find((h) => h.accion === "Aprobada por el cliente" && en(h.at));
      const suya = (p.historial ?? []).some((h) => h.by === uid && h.accion.startsWith("Enviada al cliente"));
      return p.estado === "entregada" && aprobada && suya
        ? [{ id: p.id, titulo: p.producto || p.pedido, proyecto_id: p.proyecto_id, at: aprobada.at, tipo: "pieza" as const }]
        : [];
    });
  }
  const accion =
    role === "productor"
      ? (a: string) => a.startsWith("Crudo cargado, pasa a edición")
      : role === "editor"
        ? (a: string) => a === "Edición entregada"
        : role === "pauta"
          ? (a: string) => a.startsWith("Publicado")
          : () => false;
  return videos.flatMap((v) => {
    const h = (v.historial ?? []).find((x) => x.by === uid && accion(x.accion) && en(x.at));
    return h ? [{ id: v.id, titulo: v.titulo, proyecto_id: v.proyecto_id, at: h.at, tipo: "video" as const }] : [];
  });
}

/** Cuántas unidades de trabajo hizo cada persona en el mes. */
export function unidadesDelMes(uid: string, role: string, mes: string, videos: Video[], piezas: PiezaIA[]): number {
  return trabajosDelMes(uid, role, mes, videos, piezas).length;
}

/**
 * Lo que le corresponde en el mes. En "por cliente" suma el monto de cada cliente cargado
 * (si se pasa `clientesActivos`, solo los que siguen activos).
 */
export function calcularPago(cfg: ConfigPago | undefined, unidades: number, ajustes: AjustePago[] = [], clientesActivos?: string[]) {
  const c = cfg ?? { modo: "fijo" as ModoPago, fijo: 0, por_unidad: 0 };
  const fijo = c.modo === "por_unidad" ? 0 : Number(c.fijo) || 0;
  let variable = 0;
  let clientes = 0;
  if (c.modo === "por_cliente") {
    const montos = Object.entries(c.por_cliente ?? {}).filter(([id, m]) => Number(m) > 0 && (!clientesActivos || clientesActivos.includes(id)));
    clientes = montos.length;
    variable = montos.reduce((a, [, m]) => a + Number(m), 0);
  } else if (c.modo !== "fijo") {
    variable = (Number(c.por_unidad) || 0) * unidades;
  }
  const extra = ajustes.reduce((a, x) => a + (Number(x.monto) || 0), 0);
  return { fijo, variable, extra, clientes, total: fijo + variable + extra };
}

export function useConfigPagos(enabled = true): Record<string, ConfigPago> {
  const [cfg, setCfg] = useState<Record<string, ConfigPago>>({});
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      collection(db, "equipo_pagos"),
      (s) => setCfg(Object.fromEntries(s.docs.map((d) => [d.id, d.data() as ConfigPago]))),
      () => setCfg({})
    );
  }, [enabled]);
  return cfg;
}

export function useLiquidaciones(desdeMes: string, enabled = true): Liquidacion[] {
  const [lista, setLista] = useState<Liquidacion[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, "equipo_liquidaciones"), where("mes", ">=", desdeMes)),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Liquidacion)),
      () => setLista([])
    );
  }, [desdeMes, enabled]);
  return lista;
}

export async function guardarConfigPago(uid: string, cfg: ConfigPago) {
  assertEditable();
  await setDoc(doc(db, "equipo_pagos", uid), cfg, { merge: true });
}

export async function guardarAjustes(uid: string, mes: string, ajustes: AjustePago[]) {
  assertEditable();
  await setDoc(doc(db, "equipo_liquidaciones", `${uid}_${mes}`), { uid, mes, ajustes, estado: "pendiente" }, { merge: true });
}

export async function marcarPagado(uid: string, mes: string, total: number, detalle: string, pagado: boolean) {
  assertEditable();
  await setDoc(
    doc(db, "equipo_liquidaciones", `${uid}_${mes}`),
    pagado
      ? { uid, mes, estado: "pagado", pagado_at: new Date().toISOString(), total_pagado: total, detalle }
      : { uid, mes, estado: "pendiente", pagado_at: null, total_pagado: null },
    { merge: true }
  );
}

export const logoBoleta = () => new URL(asset("/brand/logo-horizontal-negro.png"), window.location.href).href;

/** Abre la boleta en una ventana nueva lista para imprimir o guardar en PDF. */
export function abrirBoleta(f: Factura | Factura[], cobro: DatosCobro) {
  const logo = new URL(asset("/brand/logo-horizontal-negro.png"), window.location.href).href;
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("El navegador bloqueó la ventana. Permití ventanas emergentes para imprimir.");
    return;
  }
  w.document.write(htmlBoletas(Array.isArray(f) ? f : [f], cobro, logo));
  w.document.close();
}


// ---------------------------------------------------------------------------
// Gastos y libro del mes (para el contador)
// ---------------------------------------------------------------------------

export const CATEGORIAS_GASTO = [
  "Sueldos y honorarios",
  "Software y suscripciones",
  "Equipos",
  "Alquiler y servicios",
  "Impuestos",
  "Contador y bancos",
  "Viáticos y combustible",
  "Publicidad propia",
  "Otros",
] as const;
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export interface Gasto {
  id: string;
  /** YYYY-MM-DD */
  fecha: string;
  mes: string;
  concepto: string;
  categoria: CategoriaGasto;
  monto: number;
  medio: MedioCobro;
  proveedor?: string | null;
  nota?: string | null;
  /** Se repite todos los meses (alquiler, software…). */
  fijo?: boolean;
  created_at: string;
  created_by: string;
}

export function useGastos(desdeMes: string, enabled = true): Gasto[] {
  const [lista, setLista] = useState<Gasto[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, "gastos"), where("mes", ">=", desdeMes)),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Gasto).sort((a, b) => b.fecha.localeCompare(a.fecha))),
      () => setLista([])
    );
  }, [desdeMes, enabled]);
  return lista;
}

export async function guardarGasto(g: Omit<Gasto, "id" | "mes" | "created_at" | "created_by"> & { id?: string }, by: string) {
  assertEditable();
  const { id, ...rest } = g;
  const data = { ...rest, mes: rest.fecha.slice(0, 7) };
  if (id) await updateDoc(doc(db, "gastos", id), data);
  else await addDoc(collection(db, "gastos"), { ...data, created_at: new Date().toISOString(), created_by: by });
}

export async function borrarGasto(id: string) {
  assertEditable();
  await deleteDoc(doc(db, "gastos", id));
}

/** Copia los gastos fijos del mes anterior al mes elegido (mismo día). */
export async function copiarFijos(anteriores: Gasto[], mes: string, by: string): Promise<number> {
  assertEditable();
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(y, m, 0).getDate();
  let n = 0;
  for (const g of anteriores.filter((x) => x.fijo)) {
    const dia = Math.min(ultimo, Number(g.fecha.slice(8)) || 1);
    const { id: _id, created_at: _c, created_by: _b, ...rest } = g;
    await addDoc(collection(db, "gastos"), { ...rest, fecha: `${mes}-${String(dia).padStart(2, "0")}`, mes, created_at: new Date().toISOString(), created_by: by });
    n++;
  }
  return n;
}

export interface Movimiento {
  fecha: string;
  tipo: "Ingreso" | "Egreso";
  concepto: string;
  contraparte: string;
  medio: string;
  monto: number;
}

/** Libro del mes: lo que entró (cobros) y lo que salió (gastos y pagos al equipo). */
export function libroDelMes(
  mes: string,
  datos: {
    facturas: Factura[];
    cobrosMP: { concepto: string; monto: number; comision_mp?: number | null; pagado_at?: string | null; created_at: string; proyecto: string }[];
    gastos: Gasto[];
    pagosEquipo: { nombre: string; monto: number; fecha: string; detalle?: string | null }[];
    /** Cuotas de créditos, convenios e impuestos pagadas en el mes. */
    cuotas?: { fecha: string; concepto: string; entidad: string; medio: string | null; monto: number }[];
  }
): Movimiento[] {
  const medioLabel = (m?: string | null) => [...MEDIOS, ...MEDIOS_PAGO].find((x) => x.value === m)?.label ?? (m || "");
  const mov: Movimiento[] = [
    ...datos.facturas
      // Lo de Mercado Pago entra por sus cobros; lo pagado por adelantado ya entró en su momento.
      .filter((f) => f.estado === "cobrada" && f.medio !== "mercadopago" && f.medio !== "adelantado" && !!f.cobrado_at && mesAR(f.cobrado_at) === mes)
      .map((f) => ({
        fecha: f.cobrado_at ? fechaAR(f.cobrado_at) : f.fecha.slice(0, 10),
        tipo: "Ingreso" as const,
        concepto: `${f.tipo === "factura" ? "Factura" : "Boleta"} ${nombrePeriodo(f)}${f.interes_cobrado ? " (con interés por mora)" : ""}`,
        contraparte: f.razon_social || f.cliente,
        medio: medioLabel(f.medio),
        monto: f.bruto + (Number(f.interes_cobrado) || 0),
      })),
    ...datos.cobrosMP
      .filter((c) => mesAR(c.pagado_at ?? c.created_at) === mes)
      .flatMap((c) => {
        const fecha = fechaAR(c.pagado_at ?? c.created_at);
        const ingreso = { fecha, tipo: "Ingreso" as const, concepto: c.concepto, contraparte: c.proyecto, medio: "Mercado Pago", monto: c.monto };
        // La comisión que se queda MP del débito (va sumada al débito, no a la boleta).
        const comision = Number(c.comision_mp) || 0;
        return comision > 0
          ? [ingreso, { fecha, tipo: "Egreso" as const, concepto: `Comisión Mercado Pago (${c.concepto})`, contraparte: "Mercado Pago", medio: "Mercado Pago", monto: comision }]
          : [ingreso];
      }),
    ...datos.gastos
      .filter((g) => g.mes === mes)
      .map((g) => ({ fecha: g.fecha, tipo: "Egreso" as const, concepto: `${g.categoria}: ${g.concepto}`, contraparte: g.proveedor ?? "", medio: medioLabel(g.medio), monto: g.monto })),
    ...(datos.cuotas ?? []).map((c) => ({ fecha: c.fecha, tipo: "Egreso" as const, concepto: c.concepto, contraparte: c.entidad, medio: medioLabel(c.medio), monto: c.monto })),
    ...datos.pagosEquipo.map((p) => ({
      fecha: p.fecha,
      tipo: "Egreso" as const,
      concepto: `Pago equipo${p.detalle ? ` (${p.detalle})` : ""}`,
      contraparte: p.nombre,
      medio: "",
      monto: p.monto,
    })),
  ];
  return mov.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function descargarLibro(mov: Movimiento[], mes: string) {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const ingresos = mov.filter((m) => m.tipo === "Ingreso").reduce((a, m) => a + m.monto, 0);
  const egresos = mov.filter((m) => m.tipo === "Egreso").reduce((a, m) => a + m.monto, 0);
  const filas = [
    ["FECHA", "TIPO", "CONCEPTO", "CLIENTE / PROVEEDOR", "MEDIO", "MONTO"],
    ...mov.map((m) => [m.fecha.split("-").reverse().join("/"), m.tipo.toUpperCase(), m.concepto, m.contraparte, m.medio, String(m.tipo === "Egreso" ? -m.monto : m.monto)]),
    [],
    ["", "", "TOTAL INGRESOS", "", "", String(ingresos)],
    ["", "", "TOTAL EGRESOS", "", "", String(-egresos)],
    ["", "", "RESULTADO", "", "", String(ingresos - egresos)],
  ];
  const csv = "﻿" + filas.map((r) => r.map((c) => esc(String(c ?? ""))).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `libro-${mes}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------------
// Deudas e impuestos: créditos del banco, convenios de pago con ARCA e impuestos
// ---------------------------------------------------------------------------

export type TipoObligacion = "credito" | "arca" | "impuesto";

export const TIPOS_OBLIGACION: Record<TipoObligacion, { label: string; plural: string; ejemplo: string; desc: string }> = {
  credito: { label: "Crédito del banco", plural: "Créditos del banco", ejemplo: "Crédito Banco Galicia", desc: "Un préstamo que se paga en cuotas." },
  arca: { label: "Convenio con ARCA", plural: "Convenios con ARCA", ejemplo: "Plan de pagos ARCA", desc: "Un plan de facilidades de pago con ARCA." },
  impuesto: { label: "Impuesto", plural: "Impuestos", ejemplo: "Monotributo", desc: "Algo que se paga todos los meses (monotributo, IIBB, IVA…)." },
};

export interface Cuota {
  n: number;
  /** YYYY-MM-DD */
  vence: string;
  monto: number;
  pagada: boolean;
  pagada_at?: string | null;
  medio?: MedioCobro | null;
}

export interface Obligacion {
  id: string;
  tipo: TipoObligacion;
  nombre: string;
  entidad?: string | null;
  detalle?: string | null;
  cuotas: Cuota[];
  activa: boolean;
  created_at: string;
  created_by: string;
}

/** Cuotas mensuales desde la primera fecha (mismo día cada mes; si no existe, el último). */
export function generarCuotas(primera: string, cantidad: number, monto: number, desdeN = 1): Cuota[] {
  const [y, m, d] = primera.split("-").map(Number);
  return Array.from({ length: Math.max(1, Math.min(120, cantidad)) }, (_, i) => {
    const ultimo = new Date(y, m - 1 + i + 1, 0).getDate();
    const f = new Date(y, m - 1 + i, Math.min(d, ultimo));
    const vence = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
    return { n: desdeN + i, vence, monto, pagada: false, pagada_at: null, medio: null };
  });
}

export function resumenObligacion(o: Obligacion, hoy: string) {
  const pend = o.cuotas.filter((c) => !c.pagada);
  return {
    total: o.cuotas.length,
    pagadas: o.cuotas.length - pend.length,
    restante: pend.reduce((a, c) => a + c.monto, 0),
    proxima: [...pend].sort((a, b) => a.vence.localeCompare(b.vence))[0] ?? null,
    vencidas: pend.filter((c) => c.vence < hoy),
  };
}

/** Todas las cuotas sin pagar que vencen hasta `hasta` (incluye las vencidas). */
export function vencimientos(lista: Obligacion[], hasta: string) {
  return lista
    .filter((o) => o.activa)
    .flatMap((o) => o.cuotas.filter((c) => !c.pagada && c.vence <= hasta).map((c) => ({ o, c })))
    .sort((a, b) => a.c.vence.localeCompare(b.c.vence));
}

export function useObligaciones(enabled = true): Obligacion[] {
  const [lista, setLista] = useState<Obligacion[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      collection(db, "obligaciones"),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Obligacion).sort((a, b) => a.nombre.localeCompare(b.nombre))),
      () => setLista([])
    );
  }, [enabled]);
  return lista;
}

export async function crearObligacion(o: Omit<Obligacion, "id" | "created_at" | "created_by" | "activa">, by: string) {
  assertEditable();
  await addDoc(collection(db, "obligaciones"), { ...o, activa: true, created_at: new Date().toISOString(), created_by: by });
}

export async function guardarCuotas(o: Obligacion, cuotas: Cuota[]) {
  assertEditable();
  await updateDoc(doc(db, "obligaciones", o.id), { cuotas, activa: cuotas.some((c) => !c.pagada) || o.tipo === "impuesto" });
}

export async function pagarCuota(o: Obligacion, n: number, medio: MedioCobro | null, monto?: number) {
  const cuotas = o.cuotas.map((c) =>
    c.n === n
      ? { ...c, monto: monto && monto > 0 ? Math.round(monto) : c.monto, pagada: !!medio, pagada_at: medio ? new Date().toISOString() : null, medio }
      : c
  );
  await guardarCuotas(o, cuotas);
}

export async function borrarObligacion(o: Obligacion) {
  assertEditable();
  await deleteDoc(doc(db, "obligaciones", o.id));
}

/** Suma más meses a un impuesto (o cuotas a un convenio), siguiendo la última fecha. */
export async function agregarMeses(o: Obligacion, cantidad: number) {
  const ult = [...o.cuotas].sort((a, b) => a.n - b.n).at(-1);
  const base = ult ? generarCuotas(ult.vence, 2, ult.monto)[1].vence : hoyAR();
  await guardarCuotas(o, [...o.cuotas, ...generarCuotas(base, cantidad, ult?.monto ?? 0, (ult?.n ?? 0) + 1)]);
}

/** Lo que falta pagar de deuda (créditos y convenios; los impuestos son gastos del mes). */
export function deudaRestante(lista: Obligacion[], tipo?: TipoObligacion) {
  return lista
    .filter((o) => (tipo ? o.tipo === tipo : o.tipo !== "impuesto"))
    .reduce((a, o) => a + o.cuotas.filter((c) => !c.pagada).reduce((x, c) => x + c.monto, 0), 0);
}

/** Lo que vence en un mes (pagado o no). */
export function cuotasDelMes(lista: Obligacion[], mes: string) {
  return lista.flatMap((o) => o.cuotas.filter((c) => c.vence.startsWith(mes)).map((c) => ({ o, c })));
}

/** Cuotas pagadas en el mes, para el libro del contador. */
export function cuotasPagadasDelMes(lista: Obligacion[], mes: string) {
  return lista.flatMap((o) =>
    o.cuotas
      .filter((c) => c.pagada && !!c.pagada_at && mesAR(c.pagada_at) === mes)
      .map((c) => ({
        fecha: c.pagada_at ? fechaAR(c.pagada_at) : c.vence,
        concepto: `${TIPOS_OBLIGACION[o.tipo].label}: ${o.nombre}${o.tipo === "impuesto" ? "" : ` (cuota ${c.n}/${o.cuotas.length})`}`,
        entidad: o.entidad ?? "",
        medio: c.medio ?? null,
        monto: c.monto,
      }))
  );
}
