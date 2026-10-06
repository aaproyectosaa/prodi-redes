import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  size?: "sm" | "md" | "lg";
  readonly?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-7 h-7",
};

export default function StarRating({
  value,
  onChange,
  size = "md",
  readonly = false,
  className,
}: StarRatingProps) {
  const interactive = !readonly && !!onChange;

  return (
    <div className={cn("flex items-center gap-0.5", className)} role="group">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= value;
        return (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            onClick={() => onChange?.(star)}
            className={cn(
              "transition-colors p-1 -m-1 rounded-sm",
              interactive && "hover:scale-110 cursor-pointer active:scale-95",
              !interactive && "cursor-default"
            )}
            aria-label={`${star} estrella${star > 1 ? "s" : ""}`}
          >
            <Star
              className={cn(
                sizeClasses[size],
                filled
                  ? "fill-amber-400 text-amber-400"
                  : "fill-transparent text-muted-foreground/40"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
