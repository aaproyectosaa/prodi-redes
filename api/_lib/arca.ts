// Factura electrónica con ARCA (ex AFIP), directo a sus web services con @arcasdk/core: el certificado y la clave
// quedan en las variables de entorno, no pasan por ningún intermediario.
//
// Variables:
//   ARCA_CUIT          CUIT del emisor, sin guiones.
//   ARCA_CERT          Certificado (.crt, PEM). Se puede pegar el PEM o en base64 (una sola línea).
//   ARCA_KEY           Clave privada (.key, PEM). Ídem.
//   ARCA_PUNTO_VENTA   Punto de venta "Web Services" dado de alta en ARCA.
//   ARCA_CONDICION     "responsable_inscripto" (factura A/B) o "monotributo" (factura C).
//   ARCA_PRODUCCION    "true" para facturar de verdad. Sin esto es homologación (comprobantes de prueba).

import { AccessTicket, Arca, ArcaServiceNames, type ArcaServiceName, type ILoginCredentials, type ITicketStoragePort } from "@arcasdk/core";

/** Lo que recibe createNextVoucher (el paquete no exporta IVoucher desde la raíz). */
type Comprobante = Parameters<Arca["electronicBillingService"]["createNextVoucher"]>[0];
import { adminDb } from "./db";
import { HttpError } from "./auth";
import { hoyAR, sumarDias, sumarMeses } from "./fecha";
import { periodoFactura, type DatosArca, type Factura } from "./facturacion";

export type { DatosArca };

export type CondicionEmisor = "responsable_inscripto" | "monotributo";
export type CondicionReceptor = "responsable_inscripto" | "monotributo" | "exento" | "consumidor_final";

/** Códigos de ARCA. */
const CBTE = { A: 1, B: 6, C: 11 } as const;
const COND_RECEPTOR: Record<CondicionReceptor, number> = { responsable_inscripto: 1, exento: 4, consumidor_final: 5, monotributo: 6 };
const DOC_CUIT = 80;
const DOC_SIN_IDENTIFICAR = 99;
const CONCEPTO_SERVICIOS = 2;
/** Alícuota de IVA → Id de ARCA. */
const ALICUOTA: Record<string, number> = { "0": 3, "10.5": 4, "21": 5, "27": 6, "5": 8, "2.5": 9 };


const pem = (v: string) => (v.includes("-----BEGIN") ? v.replace(/\\n/g, "\n") : Buffer.from(v, "base64").toString("utf8"));

function config() {
  const { ARCA_CUIT, ARCA_CERT, ARCA_KEY, ARCA_PUNTO_VENTA, ARCA_CONDICION } = process.env;
  const falta = Object.entries({ ARCA_CUIT, ARCA_CERT, ARCA_KEY, ARCA_PUNTO_VENTA, ARCA_CONDICION }).filter(([, v]) => !v).map(([k]) => k);
  if (falta.length) throw new HttpError(503, `Falta configurar ARCA: ${falta.join(", ")}`);
  const cuit = Number(String(ARCA_CUIT).replace(/\D/g, ""));
  const puntoVenta = Number(ARCA_PUNTO_VENTA);
  if (String(cuit).length !== 11) throw new HttpError(503, "ARCA_CUIT tiene que tener 11 dígitos");
  if (!Number.isInteger(puntoVenta) || puntoVenta < 1) throw new HttpError(503, "ARCA_PUNTO_VENTA no es válido");
  if (ARCA_CONDICION !== "responsable_inscripto" && ARCA_CONDICION !== "monotributo") {
    throw new HttpError(503, 'ARCA_CONDICION tiene que ser "responsable_inscripto" o "monotributo"');
  }
  return { cuit, cert: pem(ARCA_CERT!), key: pem(ARCA_KEY!), puntoVenta, condicion: ARCA_CONDICION as CondicionEmisor, produccion: process.env.ARCA_PRODUCCION === "true" };
}

/**
 * El ticket de acceso (WSAA) dura 12 h y ARCA rechaza pedir otro mientras el anterior sigue vigente:
 * en Vercel no hay disco que dure, así que se guarda en la base (colección que solo lee el servidor).
 */
class TicketsEnBase implements ITicketStoragePort {
  constructor(private readonly entorno: "prod" | "homo") {}
  private ref(s: ArcaServiceName) {
    return adminDb().collection("arca_tickets").doc(`${this.entorno}_${s}`);
  }
  async save(ticket: AccessTicket, s: ArcaServiceName) {
    await this.ref(s).set({ ticket: ticket.toLoginCredentials(), vence: ticket.getExpiration().toISOString() });
  }
  async get(s: ArcaServiceName) {
    const d = (await this.ref(s).get()).data();
    if (!d?.ticket) return null;
    try {
      const t = AccessTicket.create(d.ticket as ILoginCredentials);
      return t.isExpired() ? null : t;
    } catch {
      return null;
    }
  }
  async delete(s: ArcaServiceName) {
    await this.ref(s).delete();
  }
}

function cliente() {
  const c = config();
  const arca = new Arca({ cuit: c.cuit, cert: c.cert, key: c.key, production: c.produccion, ticketStorage: new TicketsEnBase(c.produccion ? "prod" : "homo") });
  return { arca, ...c };
}

const aYMD = (fecha: string) => fecha.replace(/-/g, "");
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const digitos = (s?: string | null) => String(s ?? "").replace(/\D/g, "");

/** Letra según quién emite y quién recibe (desde 2021, a un monotributista un RI le hace A). */
export function letraDe(emisor: CondicionEmisor, receptor: CondicionReceptor): "A" | "B" | "C" {
  if (emisor === "monotributo") return "C";
  return receptor === "responsable_inscripto" || receptor === "monotributo" ? "A" : "B";
}

/** Arma el comprobante de ARCA para una boleta (servicios del período facturado, sin el interés por mora). */
export function comprobanteDe(f: Factura, receptor: CondicionReceptor, emisor: CondicionEmisor, puntoVenta: number, hoy = hoyAR()): { letra: "A" | "B" | "C"; datos: Comprobante } {
  const letra = letraDe(emisor, receptor);
  const cuit = digitos(f.cuit);
  if (letra === "A" && cuit.length !== 11) throw new HttpError(400, "Para factura A el cliente tiene que tener CUIT");
  const periodo = periodoFactura(f);
  // El vencimiento del pago no puede ser anterior a la fecha del comprobante.
  const vto = f.vencimiento && f.vencimiento >= hoy ? f.vencimiento : hoy;
  let neto = r2(f.neto);
  let iva = r2(f.iva);
  let alicuotas: Comprobante["Iva"];
  if (letra === "C") {
    // Monotributo: no discrimina IVA, todo es neto.
    neto = r2(f.bruto);
    iva = 0;
  } else {
    const id = ALICUOTA[String(f.iva_pct ?? 0)];
    if (!id) throw new HttpError(400, `Alícuota de IVA no soportada: ${f.iva_pct}%`);
    alicuotas = [{ Id: id, BaseImp: neto, Importe: iva }];
  }
  return {
    letra,
    datos: {
      CantReg: 1,
      PtoVta: puntoVenta,
      CbteTipo: CBTE[letra],
      Concepto: CONCEPTO_SERVICIOS,
      DocTipo: cuit.length === 11 ? DOC_CUIT : DOC_SIN_IDENTIFICAR,
      DocNro: cuit.length === 11 ? Number(cuit) : 0,
      CbteFch: aYMD(hoy),
      ImpTotal: r2(neto + iva),
      ImpTotConc: 0,
      ImpNeto: neto,
      ImpOpEx: 0,
      ImpIVA: iva,
      ImpTrib: 0,
      FchServDesde: aYMD(`${periodo}-01`),
      FchServHasta: aYMD(sumarDias(`${sumarMeses(periodo, 1)}-01`, -1)),
      FchVtoPago: aYMD(vto),
      MonId: "PES",
      MonCotiz: 1,
      CondicionIVAReceptorId: COND_RECEPTOR[receptor],
      ...(alicuotas ? { Iva: alicuotas } : {}),
    },
  };
}

/** Errores y observaciones que devuelve ARCA, en una línea. */
function motivos(r: { Errors?: { Err?: { Code?: number; Msg?: string }[] }; FeDetResp?: { FECAEDetResponse?: { Observaciones?: { Obs?: { Code?: number; Msg?: string }[] } }[] } }) {
  const lista = [...(r.Errors?.Err ?? []), ...(r.FeDetResp?.FECAEDetResponse?.[0]?.Observaciones?.Obs ?? [])];
  return lista.map((e) => `${e.Code}: ${e.Msg}`).join(" · ");
}

/** Pide el CAE para una boleta y lo guarda en ella. Si ya tenía, devuelve el que tiene. */
export async function autorizarFactura(facturaId: string, uid: string, opts: { reintentar?: boolean } = {}): Promise<DatosArca> {
  const { arca, puntoVenta, condicion, produccion } = cliente();
  const db = adminDb();
  const ref = db.collection("facturas").doc(facturaId);
  // Se marca antes de llamar a ARCA: dos clics seguidos no pueden sacar dos comprobantes.
  const f = await db.runTransaction(async (tx) => {
    const x = (await tx.get(ref)).data() as (Factura & { arca?: DatosArca; arca_en_curso_at?: string }) | undefined;
    if (!x) throw new HttpError(404, "No existe la boleta");
    if (x.arca?.cae) return x;
    if (x.tipo !== "factura") throw new HttpError(400, "Solo las facturas (con IVA) se autorizan en ARCA; las boletas no");
    if (x.estado === "borrador") throw new HttpError(400, "Primero emití la factura");
    if (x.arca_en_curso_at && !opts.reintentar) {
      throw new HttpError(409, "Ya se pidió el CAE de esta boleta y no se sabe si salió. Revisá en ARCA antes de reintentar.");
    }
    tx.update(ref, { arca_en_curso_at: new Date().toISOString() });
    return x;
  });
  if (f.arca?.cae) return f.arca;

  const p = (await db.collection("projects").doc(f.proyecto_id).get()).data() ?? {};
  const receptor = (p.facturacion?.condicion_iva as CondicionReceptor | undefined) ?? (digitos(f.cuit).length === 11 ? undefined : "consumidor_final");
  if (!receptor || !(receptor in COND_RECEPTOR)) {
    await ref.update({ arca_en_curso_at: null });
    throw new HttpError(400, "Falta la condición frente al IVA del cliente (en la ficha del cliente → facturación)");
  }
  const { letra, datos } = comprobanteDe(f, receptor, condicion, puntoVenta);
  let res;
  try {
    res = await arca.electronicBillingService.createNextVoucher(datos);
  } catch (err) {
    // Si ARCA contestó con un rechazo, no hay comprobante: se puede volver a intentar.
    const msg = err instanceof Error ? err.message : String(err);
    await ref.update({ arca_en_curso_at: null, arca_error: msg.slice(0, 500) });
    throw new HttpError(502, `ARCA no autorizó: ${msg}`);
  }
  const det = res.response.FeDetResp?.FECAEDetResponse?.[0];
  if (!res.cae || det?.Resultado !== "A") {
    const msg = motivos(res.response) || "sin detalle";
    await ref.update({ arca_en_curso_at: null, arca_error: msg.slice(0, 500) });
    throw new HttpError(502, `ARCA rechazó la factura: ${msg}`);
  }
  const datosArca: DatosArca = {
    cae: res.cae,
    cae_vto: `${res.caeFchVto.slice(0, 4)}-${res.caeFchVto.slice(4, 6)}-${res.caeFchVto.slice(6, 8)}`,
    tipo: letra,
    cbte_tipo: datos.CbteTipo,
    punto_venta: puntoVenta,
    numero: Number(det.CbteDesde),
    fecha: hoyAR(),
    homologacion: !produccion,
    autorizada_at: new Date().toISOString(),
    autorizada_por: uid,
  };
  await ref.update({ arca: datosArca, arca_en_curso_at: null, arca_error: null });
  return datosArca;
}

/** Para probar la conexión: estado de los servidores de ARCA, puntos de venta y último número. */
export async function estadoArca() {
  const { arca, puntoVenta, condicion, produccion, cuit } = cliente();
  const svc = arca.electronicBillingService;
  const servidores = await svc.getServerStatus();
  const letra = condicion === "monotributo" ? "C" : "B";
  const ultimo = await svc.getLastVoucher(puntoVenta, CBTE[letra]);
  return { produccion, cuit, punto_venta: puntoVenta, condicion, servidores, [`ultima_factura_${letra}`]: ultimo, servicio: ArcaServiceNames.WSFE };
}
