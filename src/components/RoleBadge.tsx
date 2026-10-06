import { cn } from "@/lib/utils";

interface RoleBadgeProps {
  label: string;
  className?: string;
  /** `text` = solo texto primary (sidebar). `pill` = pastilla con fondo. */
  variant?: "text" | "pill";
}

export function RoleBadge({ label, className, variant = "text" }: RoleBadgeProps) {
  return (
    <span
      className={cn(
        "inline-block max-w-full truncate leading-tight",
        variant === "text"
          ? "text-[11px] font-medium text-primary"
          : "inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
        className
      )}
    >
      {label}
    </span>
  );
}
