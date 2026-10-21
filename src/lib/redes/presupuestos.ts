import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { assertEditable } from "@/lib/redes/vistaComo";
import type { ItemPresupuesto } from "../../../api/_lib/presupuesto-calc";
import type { Propuesta } from "../../../api/_lib/propuesta";

export { totalesPresupuesto, type ItemPresupuesto } from "../../../api/_lib/presupuesto-calc";

// Presupuestos para clientes nuevos (los arma el admin; el cliente los acepta por link: api/_lib/presupuestos.ts).

export type EstadoPresupuesto = "borrador" | "enviado" | "visto" | "aceptado" | "rechazado";

export interface Presupuesto {
  id: string;
  numero: number;
  empresa: string;
  contacto: { nombre?: string | null; email?: string | null; telefono?: string | null };
  plan_id?: string | null;
  items: ItemPresupuesto[];
  moneda: "ARS" | "USD";
  tipo: "factura" | "boleta";
  /** Hasta cuándo vale (YYYY-MM-DD). */
  validez: string;
  nota?: string | null;
  /** Formato propuesta comercial (como los PDF de Prodi). Sin esto es un presupuesto viejo por ítems. */
  propuesta?: Propuesta | null;
  estado: EstadoPresupuesto;
  token: string;
  created_at: string;
  created_by: string;
  enviado_at?: string | null;
  visto_at?: string | null;
  aceptado?: { at: string; nombre: string; email: string; uid: string; proyecto_id: string } | null;
}

export const ESTADO_PRESUPUESTO: Record<EstadoPresupuesto | "vencido", { label: string; clase: string }> = {
  borrador: { label: "Borrador", clase: "bg-muted text-muted-foreground" },
  enviado: { label: "Enviado", clase: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  visto: { label: "Lo vio", clase: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  aceptado: { label: "Aceptado", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  rechazado: { label: "Rechazado", clase: "bg-red-500/15 text-red-700 dark:text-red-300" },
  vencido: { label: "Vencido", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
export const estadoVisible = (p: Presupuesto) => (p.estado !== "aceptado" && p.estado !== "rechazado" && p.validez && p.validez < hoy() ? "vencido" : p.estado);

export function usePresupuestos(activo: boolean) {
  const [lista, setLista] = useState<Presupuesto[] | null>(null);
  useEffect(() => {
    if (!activo) return;
    return onSnapshot(
      collection(db, "presupuestos"),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Presupuesto, "id">) })).sort((a, b) => b.created_at.localeCompare(a.created_at))),
      () => setLista([])
    );
  }, [activo]);
  return lista;
}

/** Link largo y difícil de adivinar para el cliente. */
function nuevoToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 40);
}

export const linkPresupuesto = (p: Pick<Presupuesto, "token">) => `${window.location.origin}/p/${p.token}`;

export async function crearPresupuesto(datos: Omit<Presupuesto, "id" | "token" | "created_at" | "estado" | "numero">, numero: number): Promise<string> {
  assertEditable();
  const r = await addDoc(collection(db, "presupuestos"), { ...datos, numero, estado: "borrador", token: nuevoToken(), created_at: new Date().toISOString() });
  return r.id;
}

export async function guardarPresupuesto(id: string, cambios: Partial<Presupuesto>) {
  assertEditable();
  await updateDoc(doc(db, "presupuestos", id), { ...cambios, updated_at: new Date().toISOString() });
}

export async function borrarPresupuesto(id: string) {
  assertEditable();
  await deleteDoc(doc(db, "presupuestos", id));
}
