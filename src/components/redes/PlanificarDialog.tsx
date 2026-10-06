import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { crearVideos, type NuevoVideo } from "@/lib/redes/videos";
import { mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { usoPlan } from "@/lib/redes/planes";
import { PlanUsage } from "./PlanUsage";

const vacio = (): NuevoVideo => ({ titulo: "", idea: "", objetivo: "", referencias: "" });

/**
 * Planificación con el cliente: se cargan varias ideas de video de una.
 */
export function PlanificarDialog({
  open,
  onOpenChange,
  clienteId: clienteInicial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clienteId?: string;
}) {
  const { clientes, planes, videos } = useRedes();
  const { user } = useUserProfileContext();
  const [clienteId, setClienteId] = useState<string>(clienteInicial ?? "");
  const [mes, setMes] = useState(mesActual());
  const [items, setItems] = useState<NuevoVideo[]>([vacio()]);
  const [extra, setExtra] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setClienteId(clienteInicial ?? clientes[0]?.id ?? "");
      setItems([vacio()]);
      setExtra(false);
      setMes(mesActual());
    }
    // Solo al abrir: si dependiera de `clientes` se reiniciaría mientras se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clienteInicial]);

  const cliente = clientes.find((c) => c.id === clienteId);
  const uso = useMemo(
    () => usoPlan(cliente, planes, videos, mes),
    [cliente, planes, videos, mes]
  );
  const validos = items.filter((i) => i.titulo.trim().length > 0);
  const quedaria = uso.usados + (extra ? 0 : validos.length);
  const seExcede = !extra && uso.cupo > 0 && quedaria > uso.cupo;

  const update = (idx: number, patch: Partial<NuevoVideo>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const save = async () => {
    if (!cliente || !user) return;
    if (validos.length === 0) {
      toast.error("Cargá al menos un título");
      return;
    }
    setSaving(true);
    try {
      await crearVideos(cliente, validos, mes, user.uid, { extra });
      toast.success(
        `${validos.length} video${validos.length === 1 ? "" : "s"} planificado${
          validos.length === 1 ? "" : "s"
        } para ${cliente.nombre}`
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const meses = [0, 1, 2].map((d) => sumarMeses(mesActual(), d));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Planificar videos</DialogTitle>
          <DialogDescription>
            Cargá las ideas que acordaste con el cliente. Después las agendás en un rodaje.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegí un cliente" />
              </SelectTrigger>
              <SelectContent>
                {clientes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Mes del plan</Label>
            <Select value={mes} onValueChange={setMes}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m) => (
                  <SelectItem key={m} value={m}>
                    {mesLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {cliente && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <PlanUsage uso={{ ...uso, usados: quedaria, pct: uso.cupo ? Math.min(100, Math.round((quedaria / uso.cupo) * 100)) : 0, excedido: Math.max(0, quedaria - uso.cupo) }} />
            {seExcede && (
              <p className="mt-2 text-xs text-muted-foreground">
                Este cliente se pasa del plan. Podés marcarlos como extra (se cobran aparte) o
                que el cliente compre videos extra desde su panel.
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          {items.map((it, idx) => (
            <div key={idx} className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {idx + 1}
                </span>
                <Input
                  value={it.titulo}
                  onChange={(e) => update(idx, { titulo: e.target.value })}
                  placeholder="Título del video (ej. Promo 2x1 de los jueves)"
                  className="font-medium"
                  autoFocus={idx === items.length - 1}
                />
                {items.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                    aria-label="Quitar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <Textarea
                value={it.idea ?? ""}
                onChange={(e) => update(idx, { idea: e.target.value })}
                placeholder="Idea / guion: qué se muestra, qué se dice, tomas clave"
                rows={2}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={it.objetivo ?? ""}
                  onChange={(e) => update(idx, { objetivo: e.target.value })}
                  placeholder="Objetivo (ej. conseguir mensajes)"
                />
                <Input
                  value={it.referencias ?? ""}
                  onChange={(e) => update(idx, { referencias: e.target.value })}
                  placeholder="Link de referencia (opcional)"
                />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setItems((p) => [...p, vacio()])}>
            <Plus className="mr-1.5 h-4 w-4" /> Otro video
          </Button>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Son videos extra</p>
            <p className="text-xs text-muted-foreground">
              No descuentan del plan: se cobran aparte.
            </p>
          </div>
          <Switch checked={extra} onCheckedChange={setExtra} />
        </label>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !cliente || validos.length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar {validos.length > 0 ? validos.length : ""} video{validos.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
