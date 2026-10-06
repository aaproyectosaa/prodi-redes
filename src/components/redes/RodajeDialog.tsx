import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { agendarRodaje, actualizarRodaje } from "@/lib/redes/videos";
import { hoyISO, mesLabel } from "@/lib/redes/format";
import { callApi } from "@/lib/redes/api";
import type { Rodaje } from "@/lib/redes/types";
import { EtapaBadge } from "./EtapaBadge";

/** Agenda (o edita) una jornada de filmación con varios videos. */
export function RodajeDialog({
  open,
  onOpenChange,
  clienteId: clienteInicial,
  rodaje,
  preseleccion,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clienteId?: string;
  rodaje?: Rodaje | null;
  preseleccion?: string[];
}) {
  const { clientes, videos } = useRedes();
  const { user } = useUserProfileContext();
  const [clienteId, setClienteId] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [hora, setHora] = useState("10:00");
  const [lugar, setLugar] = useState("");
  const [notas, setNotas] = useState("");
  const [preparar, setPreparar] = useState("");
  const [sugiriendo, setSugiriendo] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (rodaje) {
      setClienteId(rodaje.proyecto_id);
      setFecha(rodaje.fecha);
      setHora(rodaje.hora ?? "");
      setLugar(rodaje.lugar ?? "");
      setNotas(rodaje.notas ?? "");
      setPreparar(rodaje.preparar ?? "");
      setSel(new Set(rodaje.video_ids));
    } else {
      setClienteId(clienteInicial ?? "");
      setFecha(hoyISO());
      setHora("10:00");
      setLugar("");
      setNotas("");
      setPreparar("");
      setSel(new Set(preseleccion ?? []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rodaje?.id, clienteInicial]);

  const cliente = clientes.find((c) => c.id === clienteId);
  const candidatos = useMemo(
    () =>
      videos
        .filter(
          (v) =>
            v.proyecto_id === clienteId &&
            (v.etapa === "planificado" ||
              (rodaje && v.rodaje_id === rodaje.id && v.etapa === "agendado") ||
              (v.etapa === "agendado" && !v.rodaje_id))
        )
        .sort((a, b) => a.mes.localeCompare(b.mes) || a.created_at.localeCompare(b.created_at)),
    [videos, clienteId, rodaje]
  );

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    if (!cliente || !user) return;
    if (!fecha) {
      toast.error("Poné la fecha del rodaje");
      return;
    }
    const elegidos = videos.filter((v) => sel.has(v.id));
    // Los videos del rodaje que ya avanzaron (se filmaron) se mantienen.
    if (rodaje) {
      for (const v of videos) {
        if (v.rodaje_id === rodaje.id && v.etapa !== "agendado" && !sel.has(v.id)) elegidos.push(v);
      }
    }
    if (elegidos.length === 0) {
      toast.error("Elegí al menos un video para filmar");
      return;
    }
    setSaving(true);
    try {
      const datos = { fecha, hora: hora || null, lugar: lugar || null, notas: notas || null, preparar: preparar.trim() || null };
      if (rodaje) {
        await actualizarRodaje(
          rodaje,
          { ...datos, video_ids: elegidos.map((v) => v.id) },
          elegidos,
          user.uid,
          videos
        );
        toast.success("Rodaje actualizado");
      } else {
        await agendarRodaje(cliente, datos, elegidos, user.uid);
        toast.success("Rodaje agendado. Le avisamos al cliente.");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rodaje ? "Editar rodaje" : "Agendar rodaje"}</DialogTitle>
          <DialogDescription>
            Día, hora y lugar de filmación. Se filman todos los videos elegidos en la misma jornada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Select value={clienteId} onValueChange={(v) => { setClienteId(v); setSel(new Set()); }} disabled={!!rodaje}>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Hora</Label>
              <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Lugar</Label>
            <Input
              value={lugar}
              onChange={(e) => setLugar(e.target.value)}
              placeholder="Dirección o lugar de filmación"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Qué tiene que tener listo el cliente</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={!clienteId || sel.size === 0 || sugiriendo}
                onClick={async () => {
                  setSugiriendo(true);
                  try {
                    const r = await callApi<{ texto: string }>("/api/ia/preparar", {
                      proyecto_id: clienteId,
                      video_ids: Array.from(sel),
                    });
                    setPreparar(r.texto);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "No se pudo sugerir");
                  } finally {
                    setSugiriendo(false);
                  }
                }}
              >
                {sugiriendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                Sugerir con IA
              </Button>
            </div>
            <Textarea
              value={preparar}
              onChange={(e) => setPreparar(e.target.value)}
              rows={2}
              placeholder="Productos, personas, vestuario, local ordenado…"
            />
            <p className="text-[11px] text-muted-foreground">Se lo mandamos al cliente el día anterior junto con la hora y el lugar.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Notas para el equipo</Label>
            <Textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Equipo a llevar, luces, quién va…"
            />
          </div>

          <div className="space-y-2">
            <Label>Videos a filmar</Label>
            {!clienteId ? (
              <p className="text-xs text-muted-foreground">Elegí un cliente primero.</p>
            ) : candidatos.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Este cliente no tiene videos planificados sin rodaje. Planificá primero.
              </p>
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border p-2">
                {candidatos.map((v) => (
                  <label
                    key={v.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
                  >
                    <Checkbox checked={sel.has(v.id)} onCheckedChange={() => toggle(v.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{v.titulo}</span>
                      <span className="text-[11px] text-muted-foreground">{mesLabel(v.mes)}</span>
                    </span>
                    <EtapaBadge etapa={v.etapa} />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !cliente || sel.size === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {rodaje ? "Guardar cambios" : `Agendar ${sel.size} video${sel.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
