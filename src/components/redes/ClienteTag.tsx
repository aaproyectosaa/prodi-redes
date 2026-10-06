import { cn } from "@/lib/utils";
import type { Project } from "@/integrations/firebase/types";

export function ClienteTag({
  cliente,
  className,
  size = "sm",
}: {
  cliente: Pick<Project, "nombre" | "color"> | undefined;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-muted-foreground",
        size === "sm" ? "text-xs" : "text-sm",
        className
      )}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: cliente?.color || "#6F40FC" }}
      />
      <span className="truncate">{cliente?.nombre ?? "Sin cliente"}</span>
    </span>
  );
}
