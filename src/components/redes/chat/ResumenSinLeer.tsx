import { useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { callApi } from "@/lib/redes/api";

// "¿Qué me perdí?": con muchos mensajes sin leer, la IA los resume en pocas viñetas (qué se pidió, qué se decidió,
// qué quedó pendiente). Se pide con un toque, no solo (cuesta IA).

export const MIN_PARA_RESUMIR = 8;

export function ResumenSinLeer({ chatId, desde, cantidad }: { chatId: string; desde: string; cantidad: number }) {
  const [puntos, setPuntos] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cerrado, setCerrado] = useState(false);
  useEffect(() => {
    setPuntos(null);
    setCerrado(false);
  }, [chatId, desde]);

  if (cerrado || cantidad < MIN_PARA_RESUMIR) return null;

  const pedir = async () => {
    setBusy(true);
    try {
      const r = await callApi<{ puntos: string[] }>("/api/ia/chat-resumen", { chat_id: chatId, desde });
      if (!r.puntos.length) toast.message("No hay nada importante para resumir.");
      setPuntos(r.puntos);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo resumir");
    } finally {
      setBusy(false);
    }
  };

  if (!puntos) {
    return (
      <div className="mb-3 flex justify-center">
        <button
          type="button"
          onClick={() => void pedir()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md shadow-primary/25 transition-transform hover:-translate-y-0.5 disabled:opacity-80"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? "Leyendo los mensajes…" : "¿Qué me perdí? Resumímelo"}
        </button>
      </div>
    );
  }
  if (!puntos.length) return null;
  return (
    <div className="mx-auto mb-3 max-w-xl rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] to-transparent p-3.5 animate-in fade-in slide-in-from-top-1">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-white">
          <Sparkles className="h-3 w-3" />
        </span>
        <p className="flex-1 text-xs font-semibold">Lo que te perdiste ({cantidad} mensajes)</p>
        <button type="button" onClick={() => setCerrado(true)} className="rounded-full p-1 text-muted-foreground hover:bg-muted" aria-label="Cerrar resumen">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="space-y-1.5">
        {puntos.map((p, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
