// Qué clientes de Prodi Redes también son clientes de Prodi Software (para marcar sus chats).
// Se pide una vez por sesión; solo lo usa el equipo (los clientes no lo ven).

import { useEffect, useState } from "react";
import { auth } from "@/integrations/firebase/client";

let cache: Promise<Set<string>> | null = null;

function pedir(): Promise<Set<string>> {
  cache ??= (async () => {
    const user = auth.currentUser;
    if (!user) return new Set<string>();
    const res = await fetch("/api/software/clientes-en-redes", {
      method: "POST",
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    if (!res.ok) return new Set<string>();
    const d = (await res.json()) as { proyectos?: string[] };
    return new Set(d.proyectos ?? []);
  })().catch(() => {
    cache = null;
    return new Set<string>();
  });
  return cache;
}

/** Ids de clientes (projects) que también son de Software. Vacío para quien no es del equipo. */
export function useProyectosSoftware(activo: boolean): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    void pedir().then((s) => vivo && setIds(s));
    return () => {
      vivo = false;
    };
  }, [activo]);
  return ids;
}
