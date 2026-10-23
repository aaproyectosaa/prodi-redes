import { useCallback, useEffect, useRef, useState } from "react";
import { callApi } from "@/lib/redes/api";

// Borradores del equipo guardados en el servidor (/api/ia/borrador): lo que se está armando (planificar videos,
// campaña con la IA…) se guarda solo mientras se escribe y también con "Guardar borrador". Así no se pierde al cerrar,
// recargar o pasar del celular a la compu, y lo ve cualquiera del equipo.

export type EstadoBorrador = "nada" | "sin-guardar" | "guardando" | "guardado" | "error";

interface Opciones<T> {
  tipo: string;
  clave: string | null;
  proyectoId?: string | null;
  /** Lo que hay ahora en pantalla. */
  valor: T;
  /** Se llama al abrir si hay un borrador guardado (para cargarlo). */
  alCargar: (v: T) => void;
  /** Si no hay nada que guardar (ej. todo vacío), no se guarda. */
  vacio?: (v: T) => boolean;
  /** Mientras sea false no hace nada (ej. con la ventana cerrada). */
  activo?: boolean;
}

export function useBorrador<T>({ tipo, clave, proyectoId, valor, alCargar, vacio, activo = true }: Opciones<T>) {
  const [estado, setEstado] = useState<EstadoBorrador>("nada");
  const [guardadoAt, setGuardadoAt] = useState<string | null>(null);
  const [porNombre, setPorNombre] = useState<string | null>(null);
  // Hasta cargar lo que había, no se guarda (si no, se pisaría con lo vacío).
  const listo = useRef(false);
  const ultimo = useRef<string>("");
  const alCargarRef = useRef(alCargar);
  alCargarRef.current = alCargar;

  // Al abrir: trae el borrador guardado.
  useEffect(() => {
    listo.current = false;
    setEstado("nada");
    setGuardadoAt(null);
    if (!activo || !clave) return;
    let vivo = true;
    callApi<{ data: T | null; updated_at: string | null; por_nombre: string | null }>("/api/ia/borrador", { tipo, clave, ...(proyectoId ? { proyecto_id: proyectoId } : {}) })
      .then((r) => {
        if (!vivo) return;
        if (r.data != null) {
          ultimo.current = JSON.stringify(r.data);
          alCargarRef.current(r.data);
          setGuardadoAt(r.updated_at);
          setPorNombre(r.por_nombre);
          setEstado("guardado");
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (vivo) listo.current = true;
      });
    return () => {
      vivo = false;
    };
  }, [tipo, clave, proyectoId, activo]);

  const guardar = useCallback(async () => {
    if (!clave) return;
    const texto = JSON.stringify(valor);
    if (vacio?.(valor)) return;
    setEstado("guardando");
    try {
      const r = await callApi<{ updated_at: string }>("/api/ia/borrador", { tipo, clave, data: valor, ...(proyectoId ? { proyecto_id: proyectoId } : {}) });
      ultimo.current = texto;
      setGuardadoAt(r.updated_at);
      setPorNombre(null);
      setEstado("guardado");
    } catch {
      setEstado("error");
    }
  }, [tipo, clave, proyectoId, valor, vacio]);

  // Se guarda solo, 1,5 s después del último cambio.
  useEffect(() => {
    if (!activo || !clave || !listo.current) return;
    const texto = JSON.stringify(valor);
    if (texto === ultimo.current || vacio?.(valor)) return;
    setEstado("sin-guardar");
    const t = setTimeout(() => void guardar(), 1500);
    return () => clearTimeout(t);
  }, [valor, activo, clave, guardar, vacio]);

  /** Ya se usó (se creó o se cargó): se borra el borrador. */
  const descartar = useCallback(async () => {
    if (!clave) return;
    ultimo.current = "";
    setEstado("nada");
    setGuardadoAt(null);
    await callApi("/api/ia/borrador", { tipo, clave, data: null }).catch(() => undefined);
  }, [tipo, clave]);

  return { estado, guardadoAt, porNombre, guardar, descartar };
}
