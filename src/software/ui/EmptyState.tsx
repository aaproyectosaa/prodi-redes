import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Inbox className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-sm text-xs text-muted-foreground">{children}</div> : null}
    </div>
  );
}
