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
import { eliminarVideo } from "@/lib/redes/videos";
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/redes/types";

/**
 * Borrar videos desde el tablero: se activa "Borrar", se tocan las tarjetas y se confirma.
 * Los archivos de Drive no se tocan.
 */
export function useBorrarVideos(videos: Video[]) {
  const [modo, setModo] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState(false);
  const [borrando, setBorrando] = useState(false);

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
      for (const v of videos.filter((x) => sel.has(x.id))) {
        await eliminarVideo(v);
        ok++;
      }
      toast.success(ok === 1 ? "Video borrado" : `${ok} videos borrados`);
      salir();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo borrar");
    } finally {
      setBorrando(false);
      setConfirmar(false);
    }
  };

  const boton = (
    <Button variant={modo ? "default" : "outline"} size="sm" className="h-10" onClick={() => (modo ? salir() : setModo(true))}>
      {modo ? <X className="mr-1.5 h-4 w-4" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
      {modo ? "Cancelar" : "Borrar"}
    </Button>
  );

  /** La tarjeta, con la capa para marcarla cuando está el modo borrar. */
  const envolver = (v: Video, tarjeta: ReactNode) =>
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
          aria-label={`Marcar «${v.titulo}» para borrar`}
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
            <span className="text-sm">{sel.size ? `${sel.size} marcado${sel.size === 1 ? "" : "s"}` : "Tocá los videos que querés borrar"}</span>
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
            <AlertDialogTitle>¿Borrar {sel.size === 1 ? "este video" : `estos ${sel.size} videos`}?</AlertDialogTitle>
            <AlertDialogDescription>Se borran del sistema con su historial. Los archivos de Drive no se tocan.</AlertDialogDescription>
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
