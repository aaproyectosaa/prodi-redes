import { useEffect, useSyncExternalStore } from "react";
import { doc, onSnapshot, setDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { enModoVista } from "./vistaComo";

/**
 * Preferencias de la lista de chats de cada persona (chat_prefs/{uid}, solo la ve y la cambia esa persona):
 * archivados, fijados (en orden, máx. 5) y etiquetas con color asignadas a cada chat.
 */
export interface Etiqueta {
  id: string;
  nombre: string;
  color: string;
}
export interface ChatPrefs {
  archivados: string[];
  fijados: string[];
  etiquetas: Etiqueta[];
  asignaciones: Record<string, string[]>;
}

export const MAX_FIJADOS = 5;
export const COLORES_ETIQUETA = ["#6F40FC", "#E040A0", "#EF4444", "#F59E0B", "#10B981", "#0EA5E9", "#64748B"];
const VACIAS: ChatPrefs = { archivados: [], fijados: [], etiquetas: [], asignaciones: {} };

// Un solo estado compartido (la lista de /chat y la del chat flotante ven lo mismo, al instante).
let actual: ChatPrefs = VACIAS;
let deQuien: string | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());
const suscribir = (f: () => void) => (oyentes.add(f), () => oyentes.delete(f));

function normalizar(d: Partial<ChatPrefs> | undefined): ChatPrefs {
  return {
    archivados: Array.isArray(d?.archivados) ? d!.archivados : [],
    fijados: Array.isArray(d?.fijados) ? d!.fijados : [],
    etiquetas: Array.isArray(d?.etiquetas) ? d!.etiquetas : [],
    asignaciones: d?.asignaciones && typeof d.asignaciones === "object" ? d.asignaciones : {},
  };
}

export function useChatPrefs(uid: string | undefined): ChatPrefs {
  useEffect(() => {
    if (!uid) return;
    if (deQuien !== uid) {
      deQuien = uid;
      actual = VACIAS;
      avisar();
    }
    return onSnapshot(
      doc(db, "chat_prefs", uid),
      (s: { data: () => Partial<ChatPrefs> | undefined }) => {
        if (deQuien !== uid) return;
        actual = normalizar(s.data());
        avisar();
      },
      () => undefined
    );
  }, [uid]);
  return useSyncExternalStore(suscribir, () => (deQuien === uid ? actual : VACIAS));
}

async function guardar(uid: string, cambiar: (p: ChatPrefs) => ChatPrefs) {
  if (enModoVista()) throw new Error("Estás viendo como otra persona: no se puede cambiar");
  const antes = deQuien === uid ? actual : VACIAS;
  const nuevo = cambiar(antes);
  deQuien = uid;
  actual = nuevo;
  avisar();
  try {
    await setDoc(doc(db, "chat_prefs", uid), { ...nuevo, updated_at: new Date().toISOString() });
  } catch (err) {
    actual = antes;
    avisar();
    throw err;
  }
}

const sin = (xs: string[], x: string) => xs.filter((y) => y !== x);

export const fijar = (uid: string, chatId: string, si: boolean) =>
  guardar(uid, (p) => {
    if (si && !p.fijados.includes(chatId) && p.fijados.length >= MAX_FIJADOS)
      throw new Error(`Podés fijar hasta ${MAX_FIJADOS} chats. Desfijá uno primero.`);
    return {
      ...p,
      fijados: si ? [...sin(p.fijados, chatId), chatId] : sin(p.fijados, chatId),
      // Un chat fijado no queda archivado.
      archivados: si ? sin(p.archivados, chatId) : p.archivados,
    };
  });

export const archivar = (uid: string, chatId: string, si: boolean) =>
  guardar(uid, (p) => ({
    ...p,
    archivados: si ? [...sin(p.archivados, chatId), chatId] : sin(p.archivados, chatId),
    fijados: si ? sin(p.fijados, chatId) : p.fijados,
  }));

export const crearEtiqueta = (uid: string, nombre: string, color: string, chatId?: string) => {
  const n = nombre.trim().slice(0, 30);
  if (!n) return Promise.reject(new Error("Ponele un nombre a la etiqueta"));
  const id = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return guardar(uid, (p) => {
    if (p.etiquetas.some((e) => e.nombre.toLowerCase() === n.toLowerCase())) throw new Error("Ya tenés una etiqueta con ese nombre");
    return {
      ...p,
      etiquetas: [...p.etiquetas, { id, nombre: n, color }],
      asignaciones: chatId ? { ...p.asignaciones, [chatId]: [...(p.asignaciones[chatId] ?? []), id] } : p.asignaciones,
    };
  });
};

export const borrarEtiqueta = (uid: string, id: string) =>
  guardar(uid, (p) => ({
    ...p,
    etiquetas: p.etiquetas.filter((e) => e.id !== id),
    asignaciones: Object.fromEntries(
      Object.entries(p.asignaciones)
        .map(([c, es]) => [c, sin(es, id)] as const)
        .filter(([, es]) => es.length > 0)
    ),
  }));

export const asignarEtiqueta = (uid: string, chatId: string, etiquetaId: string, si: boolean) =>
  guardar(uid, (p) => {
    const es = sin(p.asignaciones[chatId] ?? [], etiquetaId);
    const asignaciones = { ...p.asignaciones, [chatId]: si ? [...es, etiquetaId] : es };
    if (!asignaciones[chatId].length) delete asignaciones[chatId];
    return { ...p, asignaciones };
  });
