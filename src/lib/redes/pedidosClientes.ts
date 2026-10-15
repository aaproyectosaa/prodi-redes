// Pedidos que hacen los clientes desde su panel (videos y piezas gráficas), para la bandeja "Pedidos" del equipo.
// "Nuevo" = entró después de la última vez que esta persona abrió la bandeja (se guarda en este navegador).

import { useEffect, useMemo, useState } from "react";
import { useAppData } from "@/contexts/app-data-context";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import type { PiezaIA, Video } from "./types";

export type PedidoCliente =
  | { tipo: "video"; id: string; clienteId: string; at: string; video: Video }
  | { tipo: "pieza"; id: string; clienteId: string; at: string; pieza: PiezaIA };

/** Días hacia atrás que muestra la bandeja. */
export const DIAS_PEDIDOS = 30;
const EVENTO = "prodi-pedidos-visto";
const clave = (uid: string) => `prodi-pedidos-visto:${uid}`;

export function leerVistoPedidos(uid: string): string {
  try {
    return localStorage.getItem(clave(uid)) ?? "";
  } catch {
    return "";
  }
}

export function marcarVistoPedidos(uid: string) {
  try {
    localStorage.setItem(clave(uid), new Date().toISOString());
  } catch {
    /* sin almacenamiento: queda como nuevo */
  }
  window.dispatchEvent(new Event(EVENTO));
}


/** Quién ve la bandeja. */
export const veePedidos = (roles: string[]) => roles.includes("admin") || roles.includes("productor");

export function usePedidosClientes() {
  const { videos, piezas } = useRedes();
  const { profiles } = useAppData();
  const { user, role, roles } = useUserProfileContext();
  const uid = user?.uid ?? "";
  const ve = veePedidos([String(role ?? ""), ...(roles ?? []).map(String)]);
  const [visto, setVisto] = useState(() => leerVistoPedidos(uid));
  useEffect(() => {
    setVisto(leerVistoPedidos(uid));
    const al = () => setVisto(leerVistoPedidos(uid));
    window.addEventListener(EVENTO, al);
    window.addEventListener("storage", al);
    return () => {
      window.removeEventListener(EVENTO, al);
      window.removeEventListener("storage", al);
    };
  }, [uid]);

  const lista = useMemo<PedidoCliente[]>(() => {
    if (!ve) return [];
    // Pieza pedida por el cliente: las nuevas traen la marca; las viejas, si la cargó un usuario cliente.
    const clientes = new Set(profiles.filter((p) => p.role === "cliente").map((p) => p.id));
    const piezaDelCliente = (p: PiezaIA) => p.pedido_cliente ?? clientes.has(p.solicitado_por);
    const desde = new Date(Date.now() - DIAS_PEDIDOS * 86_400_000).toISOString();
    return [
      ...videos.filter((v) => v.pedido_cliente && v.created_at >= desde).map((v) => ({ tipo: "video" as const, id: v.id, clienteId: v.proyecto_id, at: v.created_at, video: v })),
      ...piezas
        .filter((p) => p.created_at >= desde && p.estado !== "cancelada" && piezaDelCliente(p))
        .map((p) => ({ tipo: "pieza" as const, id: p.id, clienteId: p.proyecto_id, at: p.created_at, pieza: p })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }, [ve, videos, piezas, profiles]);

  // La primera vez (sin marca), solo cuentan como nuevos los de las últimas 24 h.
  const corte = visto || new Date(Date.now() - 86_400_000).toISOString();
  const nuevos = lista.filter((p) => p.at > corte).length;
  return { lista, nuevos, corte, ve };
}
