import { useMemo } from "react";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { pendientesDe } from "@/lib/redes/tableros";

/** Números que se muestran en el menú: lo que le toca hacer al usuario. */
export function usePendientes(): Record<string, number> {
  const { videos, chatsNoLeidos, piezas } = useRedes();
  const { role, user } = useUserProfileContext();
  const uid = user?.uid ?? "";
  return useMemo(() => {
    const out: Record<string, number> = { "/chat": chatsNoLeidos };
    if (role === "productor" || role === "editor" || role === "pauta") {
      out["/videos"] = pendientesDe(role, videos, uid);
    }
    if (role === "productor" || role === "admin") {
      out["/piezas"] = piezas.filter((p) => p.estado === "pagada" || p.estado === "en_proceso").length;
    }
    if (role === "cliente") {
      out["/cliente"] = videos.filter((v) => v.etapa === "revision_cliente").length;
    }
    return out;
  }, [videos, chatsNoLeidos, piezas, role, uid]);
}
