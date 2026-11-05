import { useEffect, useRef, useState } from "react";
import { Camera, Check, Clapperboard, ExternalLink, Film, Images, Loader2, MapPin, Pencil, RotateCw, ShieldAlert, ShieldCheck, Trash2, Video, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClientMediaCarousel } from "@/components/media/ClientMediaCarousel";
import {
  borrarVisita,
  cancelarSubidaVisita,
  crearVisita,
  editarVisita,
  esVideo,
  linkMapa,
  pesoTexto,
  reintentarSubidaVisita,
  subirAVisita,
  ubicacionActual,
  useSubidasVisita,
  videoDeVisita,
  type DatosVisita,
  type Visita,
} from "@/lib/redes/visitas";
import { cn } from "@/lib/utils";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Algo salió mal");
export const fechaCorta = (f: string) => {
  const [y, m, d] = f.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
};

// ---------------------------------------------------------------------------
// Cargar o editar los datos de la visita (antes de filmar).

export function VisitaForm({
  open,
  onOpenChange,
  visita,
  proyectoId,
  onCreada,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Para editar una que ya existe. */
  visita?: Visita | null;
  /** Solo el super admin (para probar): en qué cliente se carga. El vendedor la carga en su empresa. */
  proyectoId?: string;
  onCreada?: (id: string) => void;
}) {
  const [f, setF] = useState({ titulo: "", fabrica: "", ubicacion: "", descripcion: "", autoriza: false });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({
      titulo: visita?.titulo ?? "",
      fabrica: visita?.fabrica ?? "",
      ubicacion: visita?.ubicacion ?? "",
      descripcion: visita?.descripcion ?? "",
      autoriza: visita?.autoriza_publicar ?? false,
    });
    setCoords(visita?.coords ?? null);
  }, [open, visita]);

  const usarUbicacion = async () => {
    setBuscando(true);
    const c = await ubicacionActual();
    setBuscando(false);
    if (!c) {
      toast.error("No pudimos ver dónde estás. Fijate que el celular tenga la ubicación prendida, o escribila.");
      return;
    }
    setCoords(c);
    if (!f.ubicacion.trim()) setF((x) => ({ ...x, ubicacion: "Ubicación del celular" }));
    toast.success("Listo, guardamos dónde estás");
  };

  const guardar = async () => {
    if (f.titulo.trim().length < 3) return toast.error("Poné un título para la visita");
    if (f.fabrica.trim().length < 2) return toast.error("Poné el nombre de la fábrica");
    const datos: DatosVisita = { ...f, lat: coords?.lat ?? null, lng: coords?.lng ?? null };
    setBusy(true);
    try {
      if (visita) {
        await editarVisita(visita.id, datos);
        toast.success("Visita actualizada");
      } else {
        const r = await crearVisita(datos, proyectoId);
        onCreada?.(r.id);
      }
      onOpenChange(false);
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>{visita ? "Datos de la visita" : "Nueva visita"}</DialogTitle>
          <DialogDescription>{visita ? "Corregí lo que haga falta." : "Primero contanos de qué es. Después prendés la cámara."}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="vi-titulo">Título</Label>
            <Input id="vi-titulo" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} maxLength={120} placeholder="Ej.: Cobot de paletizado funcionando" className="h-12 text-base" autoFocus={!visita} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vi-fabrica">Fábrica</Label>
            <Input id="vi-fabrica" value={f.fabrica} onChange={(e) => setF({ ...f, fabrica: e.target.value })} maxLength={120} placeholder="Nombre de la fábrica" className="h-12 text-base" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vi-ubic">Ubicación</Label>
            <Input id="vi-ubic" value={f.ubicacion} onChange={(e) => setF({ ...f, ubicacion: e.target.value })} maxLength={200} placeholder="Ciudad o dirección" className="h-12 text-base" />
            <Button type="button" variant="outline" className="h-10 w-full" onClick={() => void usarUbicacion()} disabled={buscando}>
              {buscando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4 text-primary" />}
              {coords ? "Ubicación guardada · volver a tomarla" : "Usar mi ubicación"}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vi-desc">Descripción</Label>
            <Textarea
              id="vi-desc"
              value={f.descripcion}
              onChange={(e) => setF({ ...f, descripcion: e.target.value })}
              rows={4}
              maxLength={3000}
              placeholder="Qué se ve: qué solución tienen, qué hace el cobot, qué contó la gente de la fábrica…"
              className="text-base"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
            <Checkbox checked={f.autoriza} onCheckedChange={(v) => setF({ ...f, autoriza: v === true })} className="mt-0.5 h-5 w-5" />
            <span className="text-sm">
              <span className="font-medium">La fábrica autoriza publicar</span>
              <span className="block text-xs text-muted-foreground">Que se pueda mostrar en las redes lo que filmes ahí.</span>
            </span>
          </label>
          <DialogFooter className="pt-1">
            <Button type="submit" className="h-12 w-full text-base font-semibold" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {visita ? "Guardar" : "Seguir: prender la cámara"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cámara y subidas.

function Subidas({ visitaId }: { visitaId: string }) {
  const subidas = useSubidasVisita(visitaId);
  if (!subidas.length) return null;
  return (
    <div className="space-y-2">
      {subidas.map((s) => (
        <div key={s.id} className={cn("rounded-xl border p-2.5", s.estado === "error" && "border-destructive/50", s.estado === "espera" && "border-amber-500/50")}>
          <div className="flex items-center gap-2 text-sm">
            {esVideo(s.mime) ? <Film className="h-4 w-4 shrink-0 text-primary" /> : <Images className="h-4 w-4 shrink-0 text-primary" />}
            <span className="min-w-0 flex-1 truncate">{s.nombre}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{pesoTexto(s.size)}</span>
            {s.estado === "listo" ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : s.estado === "error" || s.estado === "espera" ? (
              <button type="button" onClick={() => reintentarSubidaVisita(s.id)} className="shrink-0 rounded p-1 text-primary" aria-label="Reintentar">
                <RotateCw className="h-4 w-4" />
              </button>
            ) : null}
            {s.estado !== "listo" && (
              <button type="button" onClick={() => cancelarSubidaVisita(s.id)} className="shrink-0 rounded p-1 text-muted-foreground" aria-label="Cancelar">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {(s.estado === "subiendo" || s.estado === "esperando") && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${s.estado === "esperando" ? 2 : Math.max(3, s.progreso)}%` }} />
            </div>
          )}
          {s.estado === "espera" && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <WifiOff className="h-3.5 w-3.5" /> {s.error === "Sin señal" ? "Sin señal: se sube sola cuando vuelva." : "Se cortó: lo volvemos a intentar solo en un rato."}
            </p>
          )}
          {s.estado === "error" && <p className="mt-1.5 text-xs text-destructive">{s.error}</p>}
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">No cierres esta página hasta que termine de subir.</p>
    </div>
  );
}

function Camara({ visitaId }: { visitaId: string }) {
  const video = useRef<HTMLInputElement>(null);
  const foto = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const tomar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    try {
      subirAVisita(visitaId, files);
    } catch (er) {
      err(er);
    }
  };
  return (
    <div className="space-y-2">
      <input ref={video} type="file" accept="video/*" capture="environment" className="hidden" onChange={tomar} />
      <input ref={foto} type="file" accept="image/*" capture="environment" className="hidden" onChange={tomar} />
      <input ref={galeria} type="file" accept="video/*,image/*" multiple className="hidden" onChange={tomar} />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => video.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 px-3 py-6 text-white shadow-lg shadow-red-500/25 transition-transform active:scale-[0.98]"
        >
          <Video className="h-8 w-8" />
          <span className="text-base font-bold">Grabar video</span>
        </button>
        <button
          type="button"
          onClick={() => foto.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-primary to-violet-600 px-3 py-6 text-white shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
        >
          <Camera className="h-8 w-8" />
          <span className="text-base font-bold">Sacar foto</span>
        </button>
      </div>
      <Button type="button" variant="outline" className="h-11 w-full" onClick={() => galeria.current?.click()}>
        <Images className="mr-2 h-4 w-4" /> Elegir de la galería
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">Cada video o foto se sube solo apenas lo terminás. Podés grabar todas las tomas que quieras.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// La visita abierta.

export function VisitaFicha({
  visita,
  open,
  onOpenChange,
  puedeSubir,
  equipo,
  onVerVideo,
}: {
  visita: Visita | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** El vendedor que la cargó (o el equipo): ve la cámara y edita los datos. */
  puedeSubir: boolean;
  /** Producción: arma el video y borra. */
  equipo?: boolean;
  onVerVideo?: (videoId: string) => void;
}) {
  const [editar, setEditar] = useState(false);
  const [busy, setBusy] = useState<null | "video" | "borrar">(null);
  const subidas = useSubidasVisita(visita?.id);
  if (!visita) return null;
  const n = visita.archivos?.length ?? 0;
  const videos = (visita.archivos ?? []).filter((a) => esVideo(a.mime_type)).length;

  const armarVideo = async () => {
    setBusy("video");
    try {
      const r = await videoDeVisita(visita.id);
      toast.success("Video creado con el material: ya está en edición");
      onVerVideo?.(r.video_id);
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };
  const borrar = async () => {
    if (!window.confirm(n ? `¿Sacar esta visita? Los ${n} archivos siguen en Drive, pero la visita deja de aparecer acá.` : "¿Borrar esta visita?")) return;
    setBusy("borrar");
    try {
      await borrarVisita(visita.id);
      onOpenChange(false);
      toast.success("Visita borrada");
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader className="space-y-1 pr-6 text-left">
            <DialogTitle className="text-lg leading-snug">{visita.titulo}</DialogTitle>
            <DialogDescription className="text-sm">
              {visita.fabrica} · {fechaCorta(visita.fecha)} · {visita.vendedor_nombre}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {puedeSubir && (
              <>
                <Camara visitaId={visita.id} />
                <Subidas visitaId={visita.id} />
              </>
            )}

            <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-sm">
              {visita.ubicacion && (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    {visita.ubicacion}
                    {visita.coords && (
                      <a href={linkMapa(visita.coords)} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                        Ver en el mapa <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                </p>
              )}
              {visita.descripcion && <p className="whitespace-pre-wrap text-muted-foreground">{visita.descripcion}</p>}
              <p className={cn("flex items-center gap-2 text-xs font-medium", visita.autoriza_publicar ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
                {visita.autoriza_publicar ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                {visita.autoriza_publicar ? "La fábrica autoriza publicar" : "Falta confirmar que la fábrica autoriza publicar"}
              </p>
              {puedeSubir && (
                <Button type="button" size="sm" variant="ghost" className="-ml-2 h-8 text-xs" onClick={() => setEditar(true)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Corregir datos
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {n ? `${n} archivo${n === 1 ? "" : "s"} subido${n === 1 ? "" : "s"}${videos ? ` · ${videos} video${videos === 1 ? "" : "s"}` : ""}` : "Todavía no hay material"}
              </p>
              {n > 0 ? (
                <ClientMediaCarousel key={n} attachments={visita.archivos} driveAvailable />
              ) : (
                !subidas.length && <p className="text-sm text-muted-foreground">{puedeSubir ? "Grabá un video o sacá una foto y aparece acá." : "El vendedor todavía no subió nada."}</p>
              )}
            </div>

            {equipo && (
              <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => void borrar()} disabled={!!busy}>
                  {busy === "borrar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />} Sacar visita
                </Button>
                {visita.video_id ? (
                  <Button variant="outline" onClick={() => onVerVideo?.(visita.video_id!)}>
                    <Check className="mr-2 h-4 w-4 text-emerald-600" /> Ver el video que se armó
                  </Button>
                ) : (
                  <Button onClick={() => void armarVideo()} disabled={!!busy || !n}>
                    {busy === "video" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 h-4 w-4" />}
                    Hacer video con esta visita
                  </Button>
                )}
              </div>
            )}
            {!equipo && puedeSubir && n === 0 && !subidas.length && (
              <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => void borrar()} disabled={!!busy}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Borrar esta visita (la cargué de más)
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <VisitaForm open={editar} onOpenChange={setEditar} visita={visita} />
    </>
  );
}

/** La tarjeta de una visita en la lista. */
export function VisitaTarjeta({ v, mia, onAbrir, cliente }: { v: Visita; mia?: boolean; onAbrir: () => void; cliente?: string }) {
  const subiendo = useSubidasVisita(v.id).filter((s) => s.estado !== "listo").length;
  const n = v.archivos?.length ?? 0;
  const tapa = v.archivos?.find((a) => a.thumbnail_link)?.thumbnail_link;
  return (
    <button type="button" onClick={onAbrir} className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors hover:border-primary/50 active:bg-muted/50">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
        {tapa ? <img src={tapa} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} /> : <Film className="h-6 w-6" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{v.titulo}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {v.fabrica}
          {cliente ? ` · ${cliente}` : ""}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span>{fechaCorta(v.fecha)}</span>
          <span className={cn(mia && "font-semibold text-primary")}>{mia ? "Vos" : v.vendedor_nombre}</span>
          <span>{n ? `${n} archivo${n === 1 ? "" : "s"}` : "sin material"}</span>
          {subiendo > 0 && <span className="font-medium text-amber-600">subiendo {subiendo}…</span>}
        </span>
      </span>
      {v.video_id && <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Video armado</span>}
    </button>
  );
}
