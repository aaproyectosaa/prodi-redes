import { useEffect } from "react";
import { toast } from "sonner";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { callApi } from "@/lib/redes/api";

// Respaldo del aviso al momento de Meta: con el sistema abierto en cualquier pantalla, el admin trae los mensajes nuevos
// al Instagram y Facebook de Prodi como leads (api/_lib/meta-leads.ts). Para no gastar:
// · el ritmo lo dice el servidor (cada 2 min si Meta no está avisando; cada 15 si el webhook anda),
// · con varias pestañas abiertas revisa una sola (se anotan en el navegador quién revisó y cuándo),
// · con la pestaña escondida no revisa; al volver a ella, revisa si ya tocaba.

const CLAVE = "prodi:meta-mensajes";
const leer = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) ?? "{}") as { at?: number; cada?: number };
  } catch {
    return {};
  }
};
const anotar = (v: { at: number; cada: number }) => {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(v));
  } catch {
    /* sin almacenamiento */
  }
};

export function MensajesMetaFondo() {
  const { roles } = useUserProfileContext();
  const admin = roles.includes("admin");
  useEffect(() => {
    if (!admin) return;
    let corriendo = false;
    const tocaRevisar = () => {
      const { at = 0, cada = 2 * 60_000 } = leer();
      return Date.now() - at >= cada;
    };
    const revisar = async () => {
      if (corriendo || document.visibilityState !== "visible" || !tocaRevisar()) return;
      corriendo = true;
      const previo = leer();
      // Se anota antes de pedir: así otra pestaña no pide lo mismo al mismo tiempo.
      anotar({ at: Date.now(), cada: previo.cada ?? 2 * 60_000 });
      try {
        const r = await callApi<{ nuevos: number; cada?: number }>("/api/web/meta-mensajes", {});
        anotar({ at: Date.now(), cada: r.cada ?? previo.cada ?? 2 * 60_000 });
        if (r.nuevos > 0) toast.success(`${r.nuevos} lead${r.nuevos === 1 ? "" : "s"} nuevo${r.nuevos === 1 ? "" : "s"} por mensaje de Instagram`);
      } catch {
        /* sin conexión o sin página conectada: se reintenta en la próxima vuelta */
      } finally {
        corriendo = false;
      }
    };
    const primero = setTimeout(() => void revisar(), 20_000);
    const t = setInterval(() => void revisar(), 60_000);
    const alVolver = () => void revisar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearTimeout(primero);
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [admin]);
  return null;
}
