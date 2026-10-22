import { useEffect } from "react";
import { toast } from "sonner";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { callApi } from "@/lib/redes/api";

// Con el sistema abierto en cualquier pantalla, el admin trae cada 2 minutos los mensajes nuevos al Instagram y
// Facebook de Prodi como leads (respaldo del aviso al momento de Meta; api/_lib/meta-leads.ts). El servidor no
// revisa más de una vez cada 2 minutos aunque haya varias pantallas abiertas.
export function MensajesMetaFondo() {
  const { roles } = useUserProfileContext();
  const admin = roles.includes("admin");
  useEffect(() => {
    if (!admin) return;
    const revisar = () =>
      callApi<{ nuevos: number }>("/api/web/meta-mensajes", {})
        .then((r) => r.nuevos > 0 && toast.success(`${r.nuevos} lead${r.nuevos === 1 ? "" : "s"} nuevo${r.nuevos === 1 ? "" : "s"} por mensaje de Instagram`))
        .catch(() => undefined);
    const primero = setTimeout(() => void revisar(), 20_000);
    const t = setInterval(() => document.visibilityState === "visible" && void revisar(), 2 * 60_000);
    return () => {
      clearTimeout(primero);
      clearInterval(t);
    };
  }, [admin]);
  return null;
}
