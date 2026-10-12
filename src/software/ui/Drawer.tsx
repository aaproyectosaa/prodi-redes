import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Panel que se abre de costado con el detalle. */
export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="mb-4">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 text-sm">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
