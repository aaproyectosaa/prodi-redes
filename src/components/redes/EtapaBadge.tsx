import { cn } from "@/lib/utils";
import { etapaInfo } from "@/lib/redes/etapas";
import type { EtapaVideo } from "@/lib/redes/types";

export function EtapaBadge({
  etapa,
  vista = "equipo",
  className,
}: {
  etapa: EtapaVideo;
  vista?: "equipo" | "cliente";
  className?: string;
}) {
  const info = etapaInfo(etapa);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        info.badge,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", info.dot)} />
      {vista === "cliente" ? info.clienteLabel : info.label}
    </span>
  );
}
