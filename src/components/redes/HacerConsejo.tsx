import { useState } from "react";
import { AlertTriangle, BookOpen, Bot, Loader2, Lock, Play, X } from "lucide-react";
import { toast } from "sonner";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";

interface ComoSeHace {
  pasos: string[];
  ojo?: string | null;
}

/**
 * "Hacer" en cada consejo de la IA: abre "Lo hago yo" (la IA lo aplica en Meta) y "Cómo se hace" (la IA explica los
 * pasos en el Administrador de anuncios). "Lo hago yo" espera el permiso de Meta para hacer cambios (ads_management).
 */
export function HacerConsejo({ proyectoId, indice }: { proyectoId: string; indice: number }) {
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState<"como" | "yo" | null>(null);
  const [como, setComo] = useState<ComoSeHace | null>(null);
  const [cargando, setCargando] = useState(false);

  const verComo = async () => {
    setVista("como");
    if (como) return;
    setCargando(true);
    try {
      setComo(await callApi<ComoSeHace>("/api/ia/pauta-como", { proyecto_id: proyectoId, indice }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no respondió");
      setVista(null);
    } finally {
      setCargando(false);
    }
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-4 text-xs font-bold text-white shadow-md shadow-primary/25 transition-transform active:scale-[0.97]"
      >
        <Play className="h-3.5 w-3.5 fill-current" /> Hacer
      </button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-2xl border bg-muted/20 p-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setVista("yo")}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-bold transition-all",
            vista === "yo" ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "border bg-card hover:border-primary/40"
          )}
        >
          <Bot className="h-3.5 w-3.5" /> Lo hago yo
        </button>
        <button
          type="button"
          onClick={() => void verComo()}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-bold transition-all",
            vista === "como" ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "border bg-card hover:border-primary/40"
          )}
        >
          {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />} Cómo se hace
        </button>
        <button
          type="button"
          onClick={() => { setAbierto(false); setVista(null); }}
          className="ml-auto rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {vista === "yo" && (
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 p-3 text-xs leading-relaxed">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-semibold">Todavía no puede hacerlo sola</p>
            <p className="text-muted-foreground">
              Falta darle a Prodi el permiso de Meta para hacer cambios en los anuncios. Mientras tanto tocá <b>Cómo se hace</b> y te explica los pasos.
            </p>
          </div>
        </div>
      )}

      {vista === "como" && cargando && (
        <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Armando los pasos…
        </div>
      )}

      {vista === "como" && como && (
        <div className="space-y-2">
          <ol className="space-y-1.5">
            {como.pasos.map((p, n) => (
              <li key={n} className="flex gap-2.5 rounded-xl bg-card p-2.5 text-xs leading-relaxed">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">{n + 1}</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
          {como.ojo && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-2.5 text-xs leading-relaxed">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>{como.ojo}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
