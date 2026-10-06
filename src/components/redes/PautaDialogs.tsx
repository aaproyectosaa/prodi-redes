import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useRedes } from "@/contexts/redes-data-context";
import { cargarResultados, guardarMetaId, guardarPauta, publicarVideo } from "@/lib/redes/videos";
import { callApi } from "@/lib/redes/api";
import { hoyISO } from "@/lib/redes/format";
import type { PautaVideo, ResultadosVideo, Video } from "@/lib/redes/types";

function num(v: string): number | null {
  const clean = v.replace(/\./g, "").replace(",", ".").trim();
  if (!clean) return null;
  const n = Number(clean);
  return isNaN(n) ? null : n;
}

const OBJETIVOS = ["Mensajes", "Ventas", "Tráfico", "Alcance", "Interacción", "Reproducciones"];

function PautaFields({
  pauta,
  setPauta,
}: {
  pauta: PautaVideo;
  setPauta: (p: PautaVideo) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <label className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Pauta activa</p>
          <p className="text-xs text-muted-foreground">Campaña en Meta Ads para este video</p>
        </div>
        <Switch checked={pauta.activa} onCheckedChange={(v) => setPauta({ ...pauta, activa: v })} />
      </label>
      {pauta.activa && (
        <>
          <div className="space-y-1.5">
            <Label>Objetivo</Label>
            <div className="flex flex-wrap gap-1.5">
              {OBJETIVOS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setPauta({ ...pauta, objetivo: o })}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    pauta.objetivo === o
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:border-primary/50"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 space-y-1.5 sm:col-span-1">
              <Label>Presupuesto (ARS)</Label>
              <Input
                inputMode="numeric"
                value={pauta.presupuesto ?? ""}
                onChange={(e) => setPauta({ ...pauta, presupuesto: num(e.target.value) })}
                placeholder="50000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Desde</Label>
              <Input
                type="date"
                value={pauta.inicio ?? ""}
                onChange={(e) => setPauta({ ...pauta, inicio: e.target.value || null })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hasta</Label>
              <Input
                type="date"
                value={pauta.fin ?? ""}
                onChange={(e) => setPauta({ ...pauta, fin: e.target.value || null })}
              />
            </div>
          </div>
          <Textarea
            rows={2}
            value={pauta.notas ?? ""}
            onChange={(e) => setPauta({ ...pauta, notas: e.target.value })}
            placeholder="Notas de la campaña (público, ubicación, etc.)"
          />
        </>
      )}
    </div>
  );
}

function MetaIdField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>ID del anuncio en Meta</Label>
      <Input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        placeholder="Ej: 120210000000000000 (opcional)"
      />
      <p className="text-[11px] text-muted-foreground">
        Copialo del Administrador de anuncios (anuncio, conjunto o campaña). Con esto los resultados se traen solos
        todos los días y no hay que cargarlos a mano.
      </p>
    </div>
  );
}

const pautaVacia = (): PautaVideo => ({
  activa: true,
  objetivo: "Mensajes",
  presupuesto: null,
  inicio: hoyISO(),
  fin: null,
  notas: null,
});

export function PublicarDialog({
  video,
  open,
  onOpenChange,
}: {
  video: Video;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useUserProfileContext();
  const { clienteById } = useRedes();
  const [ig, setIg] = useState("");
  const [fb, setFb] = useState("");
  const [tk, setTk] = useState("");
  const [pauta, setPauta] = useState<PautaVideo>(pautaVacia());
  const [metaId, setMetaId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMetaId(video.meta?.ad_id ?? "");
    setIg(video.publicacion?.link_instagram ?? "");
    setFb(video.publicacion?.link_facebook ?? "");
    setTk(video.publicacion?.link_tiktok ?? "");
    setPauta(video.pauta ?? pautaVacia());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, video.id]);

  const save = async () => {
    if (!user) return;
    if (!ig && !fb && !tk) {
      toast.error("Pegá al menos un link de la publicación");
      return;
    }
    setSaving(true);
    try {
      await publicarVideo(
        video,
        clienteById(video.proyecto_id),
        user.uid,
        { link_instagram: ig || null, link_facebook: fb || null, link_tiktok: tk || null },
        pauta
      );
      await guardarMetaId(video, metaId);
      toast.success("Video marcado como publicado. Le avisamos al cliente.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Marcar como publicado</DialogTitle>
          <DialogDescription>
            Pegá los links de la publicación y los datos de la pauta.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Link de Instagram</Label>
            <Input value={ig} onChange={(e) => setIg(e.target.value)} placeholder="https://www.instagram.com/reel/…" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Link de Facebook</Label>
              <Input value={fb} onChange={(e) => setFb(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <Label>Link de TikTok</Label>
              <Input value={tk} onChange={(e) => setTk(e.target.value)} placeholder="Opcional" />
            </div>
          </div>
          <PautaFields pauta={pauta} setPauta={setPauta} />
          {pauta.activa && <MetaIdField value={metaId} onChange={setMetaId} />}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publicado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditarPautaDialog({
  video,
  open,
  onOpenChange,
}: {
  video: Video;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useUserProfileContext();
  const [pauta, setPauta] = useState<PautaVideo>(pautaVacia());
  const [metaId, setMetaId] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPauta(video.pauta ?? pautaVacia());
    setMetaId(video.meta?.ad_id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, video.id]);
  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await guardarPauta(video, pauta, user.uid);
      await guardarMetaId(video, metaId);
      toast.success("Pauta guardada");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pauta del video</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <PautaFields pauta={pauta} setPauta={setPauta} />
          <MetaIdField value={metaId} onChange={setMetaId} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CAMPOS: { key: keyof Omit<ResultadosVideo, "actualizado_at" | "actualizado_por">; label: string; hint: string }[] = [
  { key: "alcance", label: "Alcance", hint: "Personas únicas" },
  { key: "impresiones", label: "Impresiones", hint: "Veces que se mostró" },
  { key: "reproducciones", label: "Reproducciones", hint: "ThruPlays / views" },
  { key: "interacciones", label: "Interacciones", hint: "Likes, comentarios, compartidos" },
  { key: "mensajes", label: "Mensajes", hint: "Conversaciones iniciadas" },
  { key: "clics", label: "Clics", hint: "Clics en el enlace" },
  { key: "gasto", label: "Inversión (ARS)", hint: "Importe gastado" },
];

export function ResultadosDialog({
  video,
  open,
  onOpenChange,
}: {
  video: Video;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useUserProfileContext();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [trayendo, setTrayendo] = useState(false);

  const traerDeMeta = async () => {
    setTrayendo(true);
    try {
      await callApi("/api/informes/meta", { video_id: video.id });
      toast.success("Resultados traídos de Meta");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Meta no respondió");
    } finally {
      setTrayendo(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const r = video.resultados;
    const next: Record<string, string> = {};
    for (const c of CAMPOS) {
      const v = r?.[c.key];
      next[c.key] = v === null || v === undefined ? "" : String(v);
    }
    setVals(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, video.id]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const data: Record<string, number | null> = {};
      for (const c of CAMPOS) data[c.key] = num(vals[c.key] ?? "");
      await cargarResultados(video, data, user.uid);
      toast.success("Resultados guardados. El cliente ya los ve en su panel.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resultados de la pauta</DialogTitle>
          <DialogDescription>
            {video.meta?.ad_id
              ? "Este video está conectado a Meta: los números se actualizan solos todos los días."
              : "Copialos del Administrador de anuncios, o cargá el ID del anuncio en “Pauta” para que se traigan solos."}
          </DialogDescription>
        </DialogHeader>
        {video.meta?.ad_id && (
          <Button variant="outline" onClick={traerDeMeta} disabled={trayendo} className="w-full">
            {trayendo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Traer ahora de Meta
          </Button>
        )}
        <div className="grid grid-cols-2 gap-3">
          {CAMPOS.map((c) => (
            <div key={c.key} className="space-y-1">
              <Label>{c.label}</Label>
              <Input
                inputMode="numeric"
                value={vals[c.key] ?? ""}
                onChange={(e) => setVals((p) => ({ ...p, [c.key]: e.target.value }))}
                placeholder="—"
              />
              <p className="text-[11px] text-muted-foreground">{c.hint}</p>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar resultados
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NotaDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel: string;
  onConfirm: (nota: string) => Promise<void>;
}) {
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setNota("");
  }, [open]);
  const go = async () => {
    if (!nota.trim()) {
      toast.error("Escribí qué hay que cambiar");
      return;
    }
    setSaving(true);
    try {
      await onConfirm(nota.trim());
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Textarea
          rows={5}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder={placeholder ?? "Detallá los cambios (minuto, texto, música…)"}
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={go} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
