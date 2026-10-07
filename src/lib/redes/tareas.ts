// Tareas que deja @prodi desde el chat (las crea el servidor: api/_lib/tareas.ts).
// Acá solo se leen y se marcan hechas.

import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { assertEditable } from "./vistaComo";
import type { Tarea } from "./types";

export const TAREAS = "tareas";

/** Las tareas asignadas a la persona y las que pidió ella. */
export function useTareas(uid: string | undefined) {
  const [mias, setMias] = useState<Tarea[]>([]);
  const [pedidas, setPedidas] = useState<Tarea[]>([]);
  useEffect(() => {
    if (!uid) return;
    const leer = (set: (t: Tarea[]) => void) => (snap: { docs: { id: string; data: () => unknown }[] }) =>
      set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tarea, "id">) })));
    const a = onSnapshot(query(collection(db, TAREAS), where("asignados", "array-contains", uid)), leer(setMias), () => undefined);
    const b = onSnapshot(query(collection(db, TAREAS), where("creada_por", "==", uid)), leer(setPedidas), () => undefined);
    return () => {
      a();
      b();
    };
  }, [uid]);
  return useMemo(() => {
    const orden = (x: Tarea[]) =>
      [...x].sort((p, q) => Number(p.hecha) - Number(q.hecha) || (p.vence ?? "9999").localeCompare(q.vence ?? "9999") || q.created_at.localeCompare(p.created_at));
    return {
      mias: orden(mias),
      // Las que le pidió a otros (las propias ya están en "mias").
      pedidas: orden(pedidas.filter((t) => !t.asignados.includes(uid ?? ""))),
      pendientes: mias.filter((t) => !t.hecha).length,
    };
  }, [mias, pedidas, uid]);
}

export async function marcarTarea(id: string, hecha: boolean, uid: string) {
  assertEditable();
  await updateDoc(doc(db, TAREAS, id), { hecha, hecha_at: hecha ? new Date().toISOString() : null, hecha_por: hecha ? uid : null });
}

export async function borrarTarea(id: string) {
  assertEditable();
  await deleteDoc(doc(db, TAREAS, id));
}
