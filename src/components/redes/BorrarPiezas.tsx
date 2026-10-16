import { useState, type ReactNode } from "react";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteDoc, doc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { assertEditable } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";
import type { PiezaIA } from "@/lib/redes/types";

/**
 * Borrar piezas desde el tablero (solo el super admin): se activa "Borrar", se tocan las tarjetas y se confirma.
 * Los archivos de Drive no se tocan.
 */
export function useBorrarPiezas(piezas: PiezaIA[]) {
  const [modo, setModo] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const pagadas = piezas.filter((p) => sel.has(p.id) && p.cobro_id && !p.incluida && p.estado !== "pendiente_pago").length;

  const salir = () => {
    setModo(false);
    setSel(new Set());
  };
  const tocar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const borrar = async () => {
    setBorrando(true);
    let ok = 0;
    try {
      assertEditable();
      for (const v of piezas.filter((x) => sel.has(x.id))) {
        await deleteDoc(doc(db, "piezas_ia", v.id));
        ok++;
      }
      toast.success(ok === 1 ? "Pieza borrada" : `${ok} piezas borradas`);
      salir();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo borrar");
    } finally {
      setBorrando(false);
      setConfirmar(false);
    }
  };

  const boton = (
    <Button
      variant={modo ? "destructive" : "ghost"}
      className={cn("h-11 rounded-2xl px-4 font-medium", !modo && "bg-muted/60 text-muted-foreground hover:bg-destructive/10 hover:text-destructive")}
      onClick={() => (modo ? salir() : setModo(true))}
    >
      {modo ? <X className="mr-1.5 h-4 w-4" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
      {modo ? "Cancelar" : "Borrar"}
    </Button>
  );

  /** La tarjeta, con la capa para marcarla cuando está el modo borrar. */
  const envolver = (v: PiezaIA, tarjeta: ReactNode) =>
    modo ? (
      <div className="relative">
        {tarjeta}
        <button
          type="button"
          onClick={() => tocar(v.id)}
          className={cn(
            "absolute inset-0 rounded-xl border-2 transition-colors",
            sel.has(v.id) ? "border-destructive bg-destructive/10" : "border-transparent hover:bg-destructive/5"
          )}
          aria-label="Marcar para borrar"
        >
          <span
            className={cn(
              "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 shadow",
              sel.has(v.id) ? "border-destructive bg-destructive text-white" : "border-muted-foreground/40 bg-background"
            )}
          >
            {sel.has(v.id) && <Check className="h-3.5 w-3.5" />}
          </span>
        </button>
      </div>
    ) : (
      tarjeta
    );

  const barra = (
    <>
      {modo && (
        <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-2.5 shadow-2xl animate-in slide-in-from-bottom-2">
            <span className="text-sm">{sel.size ? `${sel.size} marcado${sel.size === 1 ? "" : "s"}` : "Tocá las piezas que querés borrar"}</span>
            <Button size="sm" variant="destructive" disabled={!sel.size} onClick={() => setConfirmar(true)}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Borrar
            </Button>
            <Button size="sm" variant="ghost" onClick={salir}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      <AlertDialog open={confirmar} onOpenChange={(o) => !borrando && setConfirmar(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar {sel.size === 1 ? "esta pieza" : `estas ${sel.size} piezas`}?</AlertDialogTitle>
            <AlertDialogDescription>Se borran del sistema con sus versiones e historial. Los archivos de Drive no se tocan.{pagadas > 0 && ` ${pagadas === 1 ? "Una está pagada" : `${pagadas} están pagadas`} por el cliente: borrarla no le devuelve la plata.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={borrando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={borrando}
              onClick={(e) => {
                e.preventDefault();
                void borrar();
              }}
            >
              {borrando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return { modo, boton, envolver, barra };
}
