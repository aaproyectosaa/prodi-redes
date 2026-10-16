import { useState } from "react";
import { Loader2, Lock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/redes/api";
import { assertEditable } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";
import type { PiezaIA } from "@/lib/redes/types";
import { ESTADOS_IDEA_EDITABLE } from "../../../api/_lib/piezas";

/**
 * La idea de la pieza (lo que pidió el cliente). Se puede cambiar antes de que diseño la empiece (falta el pago o
 * para hacer): el cliente, la productora del cliente o el admin (`puede`). El servidor valida todo, deja el texto
 * anterior en el historial y le avisa a la diseñadora. Después queda de solo lectura.
 */
export function EditarIdeaPieza({ pieza, puede, className }: { pieza: PiezaIA; puede: boolean; className?: string }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(pieza.pedido ?? "");
  const [guardando, setGuardando] = useState(false);
  const abierta = ESTADOS_IDEA_EDITABLE.includes(pieza.estado);

  const guardar = async () => {
    setGuardando(true);
    try {
      assertEditable();
      await callApi("/api/pagos/pieza-idea", { pieza_id: pieza.id, pedido: texto });
      toast.success("Idea actualizada");
      setEditando(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  if (editando) {
    return (
      <div className={cn("space-y-2", className)}>
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={5}
          maxLength={2000}
          autoFocus
          className="rounded-xl text-sm"
          placeholder="Qué querés que muestre la pieza…"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={guardando} onClick={() => { setTexto(pieza.pedido ?? ""); setEditando(false); }}>
            Cancelar
          </Button>
          <Button size="sm" disabled={guardando || texto.trim().length < 10 || texto.trim() === (pieza.pedido ?? "").trim()} onClick={() => void guardar()}>
            {guardando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Guardar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group space-y-1", className)}>
      {pieza.pedido && <p className="whitespace-pre-wrap leading-relaxed">{pieza.pedido}</p>}
      {puede &&
        (abierta ? (
          <button
            type="button"
            onClick={() => { setTexto(pieza.pedido ?? ""); setEditando(true); }}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Pencil className="h-3 w-3" /> Editar idea
          </button>
        ) : (
          <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" /> Ya se está diseñando: la idea no se puede cambiar
          </p>
        ))}
    </div>
  );
}
