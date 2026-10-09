import { useNavigate, useSearchParams } from "react-router-dom";
import { Clapperboard, Image as ImageIcon, MessageSquareWarning } from "lucide-react";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import type { ReferenciaChat } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

/**
 * Tarjeta del video o la pieza de la que se habla (sale de "Hablarlo con el cliente"): título, en qué está
 * y la corrección entera. Tocándola se abre el video o la pieza.
 */
export function TarjetaReferencia({ r, mio, compacta }: { r: ReferenciaChat; mio?: boolean; compacta?: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { role } = useUserProfileContext();
  const abrir = () => {
    if (r.tipo === "video") {
      const next = new URLSearchParams(params);
      next.set("video", r.id);
      setParams(next);
    } else navigate(role === "cliente" ? `/cliente?tab=piezas&pieza=${r.id}` : `/piezas?pieza=${r.id}`);
  };
  const Icono = r.tipo === "video" ? Clapperboard : ImageIcon;
  return (
    <button
      type="button"
      onClick={abrir}
      className={cn(
        "block w-full overflow-hidden rounded-xl border text-left transition-colors",
        mio ? "border-white/25 bg-white/10 hover:bg-white/15" : "bg-background/60 hover:bg-background",
        compacta ? "" : "mb-1.5"
      )}
    >
      <div className={cn("flex items-center gap-2.5 px-3 py-2", !compacta && r.correccion && "border-b", mio ? "border-white/20" : "")}>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", mio ? "bg-white/20" : "bg-primary/10 text-primary")}>
          <Icono className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{r.titulo}</span>
          <span className={cn("block truncate text-[11px]", mio ? "text-primary-foreground/75" : "text-muted-foreground")}>
            {[r.tipo === "video" ? "Video" : "Pieza gráfica", r.detalle].filter(Boolean).join(" · ")}
          </span>
        </span>
      </div>
      {!compacta && r.correccion && (
        <div className="px-3 py-2">
          <p className={cn("mb-0.5 flex items-center gap-1 text-[11px] font-semibold", mio ? "text-primary-foreground/90" : "text-orange-600 dark:text-orange-300")}>
            <MessageSquareWarning className="h-3 w-3" /> Cambios pedidos
          </p>
          <p className={cn("line-clamp-6 whitespace-pre-wrap text-xs", mio ? "text-primary-foreground/90" : "text-foreground/90")}>{r.correccion}</p>
        </div>
      )}
    </button>
  );
}
