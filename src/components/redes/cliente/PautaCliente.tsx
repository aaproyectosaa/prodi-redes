import { useState } from "react";
import { Check, Loader2, Lock, Megaphone, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputNumero } from "@/components/ui/input-numero";
import { callApi } from "@/lib/redes/api";
import { formatARS } from "@/lib/redes/format";
import { usePerfilCliente } from "@/components/redes/cliente/PerfilCompleto";
import { cn } from "@/lib/utils";
import type { Project } from "@/integrations/firebase/types";

interface Sugerencia {
  recomendado: number;
  minimo: number;
  crecer: number;
  por_video: number;
  explicacion: string;
  mensajes_estimados: string | null;
}

/** Lo que el cliente definió invertir por mes en publicidad (lo guarda el servidor). */
export const pautaDelCliente = (c: Project | undefined) => (c as { pauta_cliente?: { monto?: number; at?: string } } | undefined)?.pauta_cliente ?? null;

/**
 * "¿Cuánto querés invertir en publicidad?": lo decide el cliente; la IA le sugiere según sus objetivos, su plan y lo
 * que rindieron sus anuncios. Con el perfil incompleto no se puede cargar (el servidor también lo controla).
 */
export function PautaClienteDialog({ cliente, open, onOpenChange, onCompletarPerfil }: { cliente: Project; open: boolean; onOpenChange: (v: boolean) => void; onCompletarPerfil?: () => void }) {
  const perfil = usePerfilCliente(cliente);
  const actual = pautaDelCliente(cliente)?.monto ?? null;
  const [monto, setMonto] = useState<number | null>(actual);
  const [sug, setSug] = useState<Sugerencia | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const completo = perfil.pct >= 100;
  const faltan = perfil.items.filter((i) => !i.listo);

  const sugerir = async () => {
    setPidiendo(true);
    try {
      const r = await callApi<Sugerencia>("/api/ia/pauta-sugerir", { proyecto_id: cliente.id });
      setSug(r);
      if (!monto) setMonto(r.recomendado);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo sugerir");
    } finally {
      setPidiendo(false);
    }
  };
  const guardar = async () => {
    if (monto == null || monto < 0) return;
    setGuardando(true);
    try {
      await callApi("/api/ia/pauta-guardar", { proyecto_id: cliente.id, monto, sugerido: sug?.recomendado ?? null });
      toast.success("¡Listo! Ya le avisamos al equipo de publicidad.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto rounded-3xl">
        <DialogHeader>
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
            <Megaphone className="h-5 w-5" />
          </span>
          <DialogTitle className="text-xl">¿Cuánto querés invertir en publicidad?</DialogTitle>
          <DialogDescription>Es lo que se gasta por mes en tus anuncios de Instagram y Facebook. Lo decidís vos; nosotros los armamos y los cuidamos.</DialogDescription>
        </DialogHeader>

        {perfil.cargando ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </p>
        ) : !completo ? (
          // Sin el perfil completo no hay con qué sugerir ni armar buenos anuncios.
          <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="flex items-center gap-2 font-semibold">
              <Lock className="h-4 w-4 text-amber-600 dark:text-amber-300" /> Primero completá tu perfil ({perfil.pct}%)
            </p>
            <p className="text-sm text-muted-foreground">Con tu negocio, tus productos y tu público podemos sugerirte cuánto invertir y armar anuncios que funcionen. Te falta:</p>
            <ul className="space-y-1 text-sm">
              {faltan.map((i) => (
                <li key={i.clave} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" /> {i.titulo}
                </li>
              ))}
            </ul>
            {onCompletarPerfil && (
              <Button className="w-full rounded-2xl" onClick={() => { onOpenChange(false); onCompletarPerfil(); }}>
                Completar mi perfil
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {!sug ? (
              <button
                type="button"
                onClick={() => void sugerir()}
                disabled={pidiendo}
                className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-gradient-to-br from-primary/[0.06] to-fuchsia-500/[0.05] p-4 text-left transition-colors hover:border-primary/70"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white">
                  {pidiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                </span>
                <span>
                  <span className="block font-semibold">{pidiendo ? "Pensando cuánto te conviene…" : "Pedile una sugerencia a la IA"}</span>
                  <span className="block text-xs text-muted-foreground">Según tus objetivos, tu plan y cómo te fue con los anuncios</span>
                </span>
              </button>
            ) : (
              <div className="space-y-3 rounded-2xl bg-muted/60 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> Sugerencia
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["Mínimo", sug.minimo],
                      ["Recomendado", sug.recomendado],
                      ["Para crecer", sug.crecer],
                    ] as const
                  ).map(([l, v]) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setMonto(v)}
                      className={cn(
                        "rounded-xl border-2 p-2 text-center transition-colors",
                        monto === v ? "border-primary bg-primary/10" : "border-transparent bg-background hover:border-primary/40"
                      )}
                    >
                      <span className="block text-[11px] text-muted-foreground">{l}</span>
                      <span className="block text-sm font-bold tabular-nums">{formatARS(v)}</span>
                    </button>
                  ))}
                </div>
                <p className="text-sm">{sug.explicacion}</p>
                <p className="text-xs text-muted-foreground">
                  Unos {formatARS(sug.por_video)} por video{sug.mensajes_estimados ? ` · podés esperar ${sug.mensajes_estimados}` : ""}.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Tu inversión por mes</p>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <InputNumero
                  value={monto ?? ""}
                  onChange={(e) => setMonto(e.target.value === "" ? null : Number(e.target.value))}
                  className="h-14 rounded-2xl border-transparent bg-muted/60 pl-8 text-lg font-semibold focus-visible:border-primary focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Lo podés cambiar cuando quieras.</p>
            </div>
            <Button className="h-12 w-full rounded-2xl text-base font-semibold shadow-lg shadow-primary/25" onClick={() => void guardar()} disabled={guardando || monto == null}>
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Guardar {monto ? formatARS(monto) : ""}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
