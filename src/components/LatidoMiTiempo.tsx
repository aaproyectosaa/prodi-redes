import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { callApi } from "@/lib/redes/api";

/** Nombre de la pantalla para "en qué" estuvo (Mi tiempo). */
const SECCIONES: Record<string, string> = {
  tablero: "Tablero",
  pedidos: "Pedidos",
  clientes: "Clientes",
  web: "Web",
  asistente: "Mi asistente",
  videos: "Videos",
  pauta: "Pauta",
  rodajes: "Rodajes",
  piezas: "Piezas gráficas",
  reuniones: "Reuniones",
  equipo: "Equipo",
  reportes: "Reportes",
  escalabilidad: "Escalabilidad",
  ajustes: "Ajustes",
  chat: "Chat",
  cobros: "Cobros",
  resumen: "Administración",
  gastos: "Gastos",
  deudas: "Deudas e impuestos",
  "pagos-equipo": "Pagos al equipo",
  "mi-tiempo": "Mi tiempo",
};

/** Sin tocar nada en estos minutos, no cuenta (la app abierta de fondo no es trabajar). */
const QUIETO = 3 * 60_000;

/**
 * Mi tiempo: mientras el admin usa la app (pestaña a la vista y tocando algo), cada minuto anota en qué pantalla está.
 * Solo el admin y solo con su propia cuenta (no cuando mira como otro).
 */
export function LatidoMiTiempo() {
  const { realRole, viewingAs } = useUserProfileContext();
  const { clientes } = useRedes();
  const { pathname } = useLocation();
  const activo = realRole === "admin" && !viewingAs;
  const ultimoToque = useRef(Date.now());
  const que = useRef("");

  const partes = pathname.split("/").filter(Boolean);
  const seccion = SECCIONES[partes[0] ?? "tablero"] ?? (partes[0] ? partes[0][0].toUpperCase() + partes[0].slice(1) : "Tablero");
  const cliente = partes[0] === "clientes" && partes[1] ? clientes.find((c) => c.id === partes[1])?.nombre : null;
  que.current = cliente ? `${seccion} · ${cliente}` : seccion;

  useEffect(() => {
    if (!activo) return;
    const toque = () => (ultimoToque.current = Date.now());
    const eventos = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    eventos.forEach((e) => window.addEventListener(e, toque, { passive: true }));
    const latir = () => {
      if (document.visibilityState !== "visible" || Date.now() - ultimoToque.current > QUIETO) return;
      void callApi("/api/usuarios/tiempo-latido", { que: que.current }).catch(() => {});
    };
    latir();
    const t = window.setInterval(latir, 60_000);
    return () => {
      window.clearInterval(t);
      eventos.forEach((e) => window.removeEventListener(e, toque));
    };
  }, [activo]);

  return null;
}
