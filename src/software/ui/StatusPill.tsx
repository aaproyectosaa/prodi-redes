import { paymentStatusEs, statusTone } from "@/software/lib/labels";
import { cn } from "@/lib/utils";

/** Estado en una pastilla de color: verde bien, amarillo esperando, rojo mal. */
export function StatusPill({ status, label }: { status?: string | null; label?: string }) {
  const tono = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        tono === "ok" && "bg-success/15 text-success",
        tono === "pending" && "bg-warning/15 text-warning",
        tono === "error" && "bg-destructive/15 text-destructive"
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label || paymentStatusEs(status)}
    </span>
  );
}
