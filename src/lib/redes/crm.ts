import { useEffect, useState } from "react";
import { Facebook, Hand, Handshake, Instagram, Megaphone, MessageCircle, Store, type LucideIcon } from "lucide-react";
import { addDoc, arrayUnion, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { assertEditable } from "@/lib/redes/vistaComo";

// CRM de cada cliente (beta, se prende por cliente con `crm_activo`): los contactos que le traen la publicidad y las
// redes, en qué etapa está cada uno, cuándo hay que volver a escribirle y cuánto se vendió. Con las ventas y la pauta
// de Meta se calcula cuánto costó cada venta de verdad.

export const CONTACTOS = "crm_contactos";
export const VENDEDORES = "crm_vendedores";

export type EtapaCrm = "nuevo" | "contactado" | "presupuesto" | "vendido" | "perdido";
export type OrigenCrm = "anuncio" | "whatsapp" | "instagram" | "facebook" | "local" | "recomendado" | "otro";

export interface EventoCrm {
  at: string;
  texto: string;
  /** mio: lo que le escribió; suyo: lo que respondió; nota, llamada, visita, email: lo que se anotó; sin tipo: movimiento del sistema. */
  tipo?: "mio" | "suyo" | "nota" | "llamada" | "visita" | "email";
  /** Por dónde fue el mensaje. */
  canal?: CanalCrm;
}

/** Por dónde se le escribe: el chat de cada red. */
export type CanalCrm = "whatsapp" | "instagram" | "facebook";

export interface ContactoCrm {
  id: string;
  proyecto_id: string;
  nombre: string;
  telefono?: string | null;
  email?: string | null;
  /** Usuario de Instagram (sin @) y de Facebook, para escribirle por ahí. */
  instagram?: string | null;
  facebook?: string | null;
  origen: OrigenCrm;
  /** Qué quiere o qué consultó. */
  interes?: string | null;
  notas?: string | null;
  etapa: EtapaCrm;
  /** Cuándo hay que volver a escribirle (YYYY-MM-DD). */
  proximo?: string | null;
  /** Qué hay que hacer ese día (próximo paso). */
  proximo_texto?: string | null;
  monto_venta?: number | null;
  vendido_at?: string | null;
  perdido_motivo?: string | null;
  /** Quién del equipo del cliente lo atiende (crm_vendedores). */
  vendedor_id?: string | null;
  /** El video de Prodi que lo trajo (si vino por un anuncio): para saber qué video vende. */
  video_id?: string | null;
  historial?: EventoCrm[];
  creado_at: string;
  actualizado_at: string;
}

/** Alguien del equipo del cliente que atiende contactos (todavía sin usuario propio). */
export interface VendedorCrm {
  id: string;
  proyecto_id: string;
  nombre: string;
  telefono?: string | null;
  activo: boolean;
  creado_at: string;
}

export const ETAPAS: { k: EtapaCrm; label: string; ayuda: string; color: string; punto: string; texto: string }[] = [
  { k: "nuevo", label: "Nuevos", ayuda: "Te escribieron y todavía no les contestaste.", color: "border-t-sky-500", punto: "bg-sky-500", texto: "text-sky-600 dark:text-sky-400" },
  { k: "contactado", label: "Les escribí", ayuda: "Ya les contestaste: falta que decidan.", color: "border-t-violet-500", punto: "bg-violet-500", texto: "text-violet-600 dark:text-violet-400" },
  { k: "presupuesto", label: "Presupuesto", ayuda: "Les pasaste precio.", color: "border-t-orange-500", punto: "bg-orange-500", texto: "text-orange-600 dark:text-orange-400" },
  { k: "vendido", label: "Vendido", ayuda: "Compraron.", color: "border-t-emerald-500", punto: "bg-emerald-500", texto: "text-emerald-600 dark:text-emerald-400" },
  { k: "perdido", label: "No compró", ayuda: "No avanzó.", color: "border-t-muted-foreground/50", punto: "bg-muted-foreground", texto: "text-muted-foreground" },
];

/** De dónde llegó: ícono y color de la etiqueta, como en Leads. */
export const ORIGENES: { k: OrigenCrm; label: string; icono: LucideIcon; clase: string }[] = [
  { k: "anuncio", label: "Anuncio de Meta", icono: Megaphone, clase: "bg-blue-500/12 text-blue-700 dark:text-blue-300" },
  { k: "whatsapp", label: "WhatsApp", icono: MessageCircle, clase: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  { k: "instagram", label: "Instagram", icono: Instagram, clase: "bg-pink-500/12 text-pink-700 dark:text-pink-300" },
  { k: "facebook", label: "Facebook", icono: Facebook, clase: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  { k: "local", label: "Vino al local", icono: Store, clase: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  { k: "recomendado", label: "Recomendado", icono: Handshake, clase: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  { k: "otro", label: "Otro", icono: Hand, clase: "bg-muted text-muted-foreground" },
];

const ahora = () => new Date().toISOString();
const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
export const sumarDiasCrm = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};

export function useContactos(proyectoId: string | undefined) {
  const [lista, setLista] = useState<ContactoCrm[] | null>(null);
  useEffect(() => {
    if (!proyectoId) return;
    return onSnapshot(
      query(collection(db, CONTACTOS), where("proyecto_id", "==", proyectoId)),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ContactoCrm, "id">) })).sort((a, b) => b.creado_at.localeCompare(a.creado_at))),
      () => setLista([])
    );
  }, [proyectoId]);
  return lista;
}

export function useVendedores(proyectoId: string | undefined) {
  const [lista, setLista] = useState<VendedorCrm[] | null>(null);
  useEffect(() => {
    if (!proyectoId) return;
    return onSnapshot(
      query(collection(db, VENDEDORES), where("proyecto_id", "==", proyectoId)),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<VendedorCrm, "id">) })).sort((a, b) => a.creado_at.localeCompare(b.creado_at))),
      () => setLista([])
    );
  }, [proyectoId]);
  return lista;
}

export async function crearVendedor(proyectoId: string, datos: Pick<VendedorCrm, "nombre" | "telefono">) {
  assertEditable();
  await addDoc(collection(db, VENDEDORES), { proyecto_id: proyectoId, ...datos, activo: true, creado_at: ahora() });
}

export async function editarVendedor(v: VendedorCrm, cambios: Partial<Pick<VendedorCrm, "nombre" | "telefono" | "activo">>) {
  assertEditable();
  await updateDoc(doc(db, VENDEDORES, v.id), cambios);
}

/** Lo saca del equipo; sus contactos quedan sin asignar. */
export async function borrarVendedor(v: VendedorCrm, contactos: ContactoCrm[]) {
  assertEditable();
  await Promise.all(contactos.filter((c) => c.vendedor_id === v.id).map((c) => updateDoc(doc(db, CONTACTOS, c.id), { vendedor_id: null })));
  await deleteDoc(doc(db, VENDEDORES, v.id));
}

const abierto = (c: ContactoCrm) => c.etapa !== "vendido" && c.etapa !== "perdido";

/** A quién darle el próximo contacto: el vendedor activo con menos contactos abiertos (reparto parejo). */
export function vendedorSugerido(vendedores: VendedorCrm[], contactos: ContactoCrm[]): string | null {
  const activos = vendedores.filter((v) => v.activo);
  if (!activos.length) return null;
  const carga = (id: string) => contactos.filter((c) => c.vendedor_id === id && abierto(c)).length;
  return [...activos].sort((a, b) => carga(a.id) - carga(b.id))[0].id;
}

export async function asignarContacto(c: ContactoCrm, vendedor: VendedorCrm | null) {
  assertEditable();
  const at = ahora();
  await updateDoc(doc(db, CONTACTOS, c.id), {
    vendedor_id: vendedor?.id ?? null,
    actualizado_at: at,
    historial: arrayUnion({ at, texto: vendedor ? `Lo atiende ${vendedor.nombre}` : "Sin asignar" }),
  });
}

/** Cómo le va a cada vendedor en el mes. */
export function resumenVendedor(v: VendedorCrm, lista: ContactoCrm[], mes: string) {
  const suyos = lista.filter((c) => c.vendedor_id === v.id);
  const r = resumenCrm(suyos, mes);
  return { ...r, abiertos: suyos.filter(abierto).length, asignados: suyos.length };
}

/** Contacto nuevo: arranca en "Nuevos" y con recordatorio para hoy (al que escribe, hay que contestarle ya). */
export async function crearContacto(proyectoId: string, datos: Pick<ContactoCrm, "nombre" | "telefono" | "email" | "origen" | "interes" | "notas" | "vendedor_id"> & Partial<Pick<ContactoCrm, "instagram" | "facebook" | "video_id">>) {
  assertEditable();
  const at = ahora();
  const r = await addDoc(collection(db, CONTACTOS), {
    proyecto_id: proyectoId,
    ...datos,
    etapa: "nuevo",
    proximo: hoyAR(),
    historial: [{ at, texto: "Contacto cargado" }],
    creado_at: at,
    actualizado_at: at,
  });
  return r.id;
}

/** Pasarlo de etapa. Al escribirle, el próximo seguimiento queda en 2 días; con presupuesto, en 3. */
export async function moverContacto(c: ContactoCrm, etapa: EtapaCrm, extra: { monto?: number | null; motivo?: string | null } = {}) {
  assertEditable();
  if (c.etapa === etapa && etapa !== "vendido") return;
  const at = ahora();
  const proximo = etapa === "contactado" ? sumarDiasCrm(hoyAR(), 2) : etapa === "presupuesto" ? sumarDiasCrm(hoyAR(), 3) : etapa === "nuevo" ? hoyAR() : null;
  const label = ETAPAS.find((e) => e.k === etapa)?.label ?? etapa;
  await updateDoc(doc(db, CONTACTOS, c.id), {
    etapa,
    proximo,
    ...(etapa === "vendido" ? { monto_venta: extra.monto ?? c.monto_venta ?? null, vendido_at: c.vendido_at ?? at } : {}),
    ...(etapa === "perdido" ? { perdido_motivo: extra.motivo ?? null } : {}),
    actualizado_at: at,
    historial: arrayUnion({
      at,
      texto: etapa === "vendido" && extra.monto ? `Vendido por $ ${Math.round(extra.monto).toLocaleString("es-AR")}` : etapa === "perdido" && extra.motivo ? `No compró: ${extra.motivo}` : `Pasó a «${label}»`,
    }),
  });
}

export async function editarContacto(
  c: ContactoCrm,
  cambios: Partial<Pick<ContactoCrm, "nombre" | "telefono" | "email" | "instagram" | "facebook" | "origen" | "interes" | "notas" | "proximo" | "proximo_texto" | "monto_venta" | "video_id">>
) {
  assertEditable();
  await updateDoc(doc(db, CONTACTOS, c.id), { ...cambios, actualizado_at: ahora() });
}

export async function anotarContacto(c: ContactoCrm, texto: string, tipo: "nota" | "suyo" | "llamada" | "visita" | "email" = "nota", canal?: CanalCrm) {
  assertEditable();
  const at = ahora();
  await updateDoc(doc(db, CONTACTOS, c.id), {
    actualizado_at: at,
    // Si respondió y estaba en "Nuevos", ya hay charla: pasa a "Les escribí".
    ...(tipo === "suyo" && c.etapa === "nuevo" ? { etapa: "contactado", proximo: hoyAR() } : {}),
    historial: arrayUnion({ at, texto: texto.slice(0, 2000), tipo, ...(canal ? { canal } : {}) }),
  });
}

/** Le escribió (se abre el chat de la red con el texto): queda en la charla y, si era nuevo, pasa a "Les escribí". */
export async function escribirContacto(c: ContactoCrm, texto: string, canal: CanalCrm) {
  assertEditable();
  const at = ahora();
  await updateDoc(doc(db, CONTACTOS, c.id), {
    actualizado_at: at,
    ...(c.etapa === "nuevo" ? { etapa: "contactado" } : {}),
    proximo: c.etapa === "vendido" || c.etapa === "perdido" ? null : sumarDiasCrm(hoyAR(), 2),
    historial: arrayUnion({ at, texto: texto.slice(0, 2000), tipo: "mio", canal }),
  });
}

/** Los canales por los que se le puede escribir (según los datos que tiene). */
export function canalesDe(c: Pick<ContactoCrm, "telefono" | "instagram" | "facebook">): CanalCrm[] {
  return [c.telefono && "whatsapp", c.instagram && "instagram", c.facebook && "facebook"].filter(Boolean) as CanalCrm[];
}

/** El link que abre el chat de esa red (en WhatsApp con el texto ya escrito; en Instagram y Facebook se pega). */
export function linkCanal(c: Pick<ContactoCrm, "telefono" | "instagram" | "facebook">, canal: CanalCrm, texto = "") {
  if (canal === "whatsapp") return linkWhatsApp(c.telefono, texto);
  const usuario = String((canal === "instagram" ? c.instagram : c.facebook) ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?(instagram|facebook)\.com\//, "")
    .replace(/\/.*$/, "");
  return canal === "instagram" ? `https://ig.me/m/${usuario}` : `https://m.me/${usuario}`;
}

export async function borrarContacto(c: ContactoCrm) {
  assertEditable();
  await deleteDoc(doc(db, CONTACTOS, c.id));
}

/** Link de WhatsApp con el número argentino armado (549 + área + número) y el mensaje. */
export function linkWhatsApp(telefono: string | null | undefined, texto = "") {
  let n = String(telefono ?? "").replace(/\D/g, "");
  if (n.startsWith("0")) n = n.slice(1);
  if (n && !n.startsWith("54")) n = `549${n.replace(/^15/, "")}`;
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

/** Números del mes: contactos nuevos, vendidos, cuánto se vendió y qué parte compró. */
export function resumenCrm(lista: ContactoCrm[], mes: string) {
  const delMes = lista.filter((c) => c.creado_at.slice(0, 7) === mes);
  const vendidos = lista.filter((c) => c.etapa === "vendido" && (c.vendido_at ?? c.actualizado_at).slice(0, 7) === mes);
  const total = vendidos.reduce((a, c) => a + (Number(c.monto_venta) || 0), 0);
  const hoy = hoyAR();
  const paraHoy = lista.filter((c) => c.proximo && c.proximo <= hoy && c.etapa !== "vendido" && c.etapa !== "perdido");
  return {
    nuevos: delMes.length,
    vendidos: vendidos.length,
    total,
    conversion: delMes.length ? vendidos.filter((c) => c.creado_at.slice(0, 7) === mes).length / delMes.length : null,
    paraHoy,
  };
}

/** Los videos del cliente que pudieron traer contactos (ya le llegaron o están publicados), del más nuevo al más viejo. */
export function videosParaElegir<T extends { proyecto_id: string; etapa: string; mes: string; titulo: string; id: string }>(videos: T[], proyectoId: string): T[] {
  return videos
    .filter((v) => v.proyecto_id === proyectoId && ["para_publicar", "publicado", "revision_cliente"].includes(v.etapa))
    .sort((a, b) => b.mes.localeCompare(a.mes))
    .slice(0, 30);
}
