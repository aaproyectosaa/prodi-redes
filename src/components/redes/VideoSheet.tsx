import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  Check,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  FolderOpen,
  History,
  Link2,
  ListChecks,
  RefreshCw,
  Loader2,
  MapPin,
  MessageSquareWarning,
  Pencil,
  Send,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import StarRating from "@/components/StarRating";
import { cn } from "@/lib/utils";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { ETAPAS, aceptaMaterialCliente, diasEnEtapa, estaTrabado, etapaInfo, quienFilma, soloPauta } from "@/lib/redes/etapas";
import { fechaCorta, fechaHora, formatARS, formatNum, hace, mesLabel } from "@/lib/redes/format";
import {
  actualizarVideo,
  aprobarCliente,
  aprobarInterno,
  eliminarVideo,
  entregarEdicion,
  cambiarEntrega,
  enviarAPauta,
  enviarAEdicion,
  filmarNosotros,
  forzarEtapa,
  guardarGuion,
  pedirCambiosCliente,
  pedirCambiosInterno,
  pasarAMaterialCliente,
} from "@/lib/redes/videos";
import { callApi } from "@/lib/redes/api";
import type { EtapaVideo, Video } from "@/lib/redes/types";
import { EtapaBadge } from "./EtapaBadge";
import { EntregaChip, EntregaEdicionDialog } from "./EntregaEdicion";
import { ClienteTag } from "./ClienteTag";
import { HablarConCliente } from "./HablarConCliente";
import { MaterialElegido, MaterialSlot } from "./MaterialSlot";
import { TextoConLinks } from "./DelSistemaAnterior";
import { CorreccionesDialog, MarcasEdicion } from "./MarcasVideo";
import { EditarPautaDialog, PublicarDialog, ResultadosDialog } from "./PautaDialogs";
import { RodajeDialog } from "./RodajeDialog";
import { SubirMaterial } from "./cliente/SubirMaterial";

function Block({
  icon: Icon,
  title,
  children,
  actions,
  className,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Panel de detalle del video. Se abre con ?video=<id> desde cualquier pantalla. */
export function VideoSheet() {
  const [params, setParams] = useSearchParams();
  const videoId = params.get("video");
  const { videos } = useRedes();
  const video = videos.find((v) => v.id === videoId);

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("video");
    setParams(next, { replace: true });
  };

  return (
    <Sheet open={!!videoId} onOpenChange={(o) => !o && close()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {video ? (
          <VideoDetail video={video} onClose={close} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            <SheetHeader className="sr-only">
              <SheetTitle>Video</SheetTitle>
            </SheetHeader>
            {videoId ? "Cargando video…" : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function VideoDetail({ video, onClose }: { video: Video; onClose: () => void }) {
  const { role, user } = useUserProfileContext();
  const { profiles } = useAppData();
  const { clienteById, rodajes, settings } = useRedes();
  const uid = user?.uid ?? "";
  const cliente = clienteById(video.proyecto_id);
  const rodaje = video.rodaje_id ? rodajes.find((r) => r.id === video.rodaje_id) : undefined;

  const isAdmin = role === "admin";
  const isProd = isAdmin || role === "productor";
  const isEditor = isAdmin || role === "editor";
  const isPauta = isAdmin || role === "pauta";
  const isCliente = role === "cliente";
  const info = etapaInfo(video.etapa);

  const [busy, setBusy] = useState<string | null>(null);
  const [notaOpen, setNotaOpen] = useState<null | "interno" | "cliente">(null);
  const [publicarOpen, setPublicarOpen] = useState(false);
  const [pautaOpen, setPautaOpen] = useState(false);
  const [resultadosOpen, setResultadosOpen] = useState(false);
  const [rodajeOpen, setRodajeOpen] = useState(false);
  // "¿Para cuándo lo necesitás editado?": al mandar a edición ("enviar") o para cambiar la fecha ("cambiar").
  const [entregaDlg, setEntregaDlg] = useState<null | "enviar" | "cambiar">(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Algo salió mal");
    } finally {
      setBusy(null);
    }
  };

  const nombre = (id: string | null | undefined) =>
    profiles.find((p) => p.id === id)?.nombre ?? (id ? "Usuario" : "Sin asignar");

  const hasCrudo = (video.attachments_crudo?.length ?? 0) > 0;
  const hasFinal = (video.attachments_finalizado?.length ?? 0) > 0;
  const feedback = video.etapa === "edicion" ? video.feedback_cliente || video.feedback_interno : null;
  const feedbackDe = video.feedback_cliente ? "el cliente" : "producción";
  const trabado = !isCliente && estaTrabado(video, settings.dias_alerta);
  const avanzado = ["revision_interna", "revision_cliente", "para_publicar", "publicado"].includes(video.etapa);
  const filma = quienFilma(cliente);
  const delCliente = (video.attachments_crudo ?? []).filter((a) => a.origen === "cliente").length;

  return (
    <>
      <SheetHeader className="space-y-2 border-b px-5 pb-4 pt-5 text-left">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <ClienteTag cliente={cliente} size="md" />
          <span className="text-muted-foreground/50">·</span>
          <span className="text-xs text-muted-foreground">{mesLabel(video.mes)}</span>
          {video.extra && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              EXTRA
            </span>
          )}
        </div>
        <SheetTitle className="text-xl leading-tight">{video.titulo}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2">
            <EtapaBadge etapa={video.etapa} vista={isCliente ? "cliente" : "equipo"} />
            {!isCliente && <EntregaChip video={video} />}
            {isProd && video.etapa === "edicion" && (
              <button type="button" onClick={() => setEntregaDlg("cambiar")} className="text-xs text-primary underline-offset-2 hover:underline">
                {video.entrega_edicion ? "Cambiar fecha" : "Poner fecha de entrega"}
              </button>
            )}
            {!isCliente && video.etapa !== "publicado" && (
              <span className={cn("text-xs", trabado ? "font-medium text-warning" : "text-muted-foreground")}>
                {trabado && <AlertTriangle className="mr-1 inline h-3 w-3" />}
                {diasEnEtapa(video) === 1 ? "1 día" : `${diasEnEtapa(video)} días`} en esta etapa · le toca{" "}
                {info.responsable === "cliente" ? "al cliente" : `a ${roleNombre(info.responsable)}`}
              </span>
            )}
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {feedback && !isCliente && (
          <div className="rounded-xl border border-orange-500/40 bg-orange-500/[0.08] p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-orange-700 dark:text-orange-300">
              <MessageSquareWarning className="h-3.5 w-3.5" />
              Cambios pedidos por {feedbackDe}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{feedback}</p>
            {(video.feedback_marcas?.length ?? 0) > 0 && <MarcasEdicion video={video} marcas={video.feedback_marcas!} />}
            {video.feedback_cliente && (
              <HablarConCliente proyectoId={video.proyecto_id} que={`el video “${video.titulo}”`} pedido={feedback} className="mt-2 h-8 bg-background/60 text-xs" />
            )}
          </div>
        )}

        {!isCliente && video.etapa === "revision_cliente" && <RecordatorioCliente video={video} />}

        {!isCliente && (video.filma_cliente || delCliente > 0) && (
          <p className="flex items-start gap-2 rounded-xl border border-violet-500/30 bg-violet-500/[0.07] px-3 py-2.5 text-xs">
            <Smartphone className="mt-px h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
            <span>
              {video.etapa === "material_cliente"
                ? delCliente
                  ? `Lo filma el cliente: ya subió ${delCliente} archivo${delCliente === 1 ? "" : "s"}. Pasa a edición cuando avise que terminó (o mandalo vos).`
                  : "Lo filma el cliente: estamos esperando que suba su material desde su panel."
                : video.filma_cliente
                  ? `Lo filmó el cliente${delCliente ? ` · ${delCliente} archivo${delCliente === 1 ? "" : "s"} suyo${delCliente === 1 ? "" : "s"} en el crudo` : ""}.`
                  : `El cliente mandó ${delCliente} archivo${delCliente === 1 ? "" : "s"} de material extra (en el crudo).`}
            </span>
          </p>
        )}

        {!isCliente && video.material_base?.tipo === "existente" && (
          <Block icon={FolderOpen} title="Material elegido por el cliente">
            <MaterialElegido video={video} />
          </Block>
        )}
        {!isCliente && video.material_base?.tipo === "nueva" && video.material_base.preferencia && video.etapa === "planificado" && (
          <p className="flex items-start gap-2 rounded-xl border bg-muted/30 px-3 py-2.5 text-xs">
            <CalendarDays className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
            Para filmar, al cliente le quedan mejor: {video.material_base.preferencia.toLowerCase()}.
          </p>
        )}

        {isCliente ? (
          <ClienteView video={video} />
        ) : (
          <>
            {avanzado ? (
              <>
                {/* Ya hay video final: lo primero es verlo */}
                {!["planificado", "agendado", "material_cliente"].includes(video.etapa) && (
              <Block icon={Film} title="Video final">
                <MaterialSlot
                  video={video}
                  slot="finalizado"
                  clienteNombre={cliente?.nombre ?? "Cliente"}
                  canUpload={(isEditor && video.etapa === "edicion") || isAdmin}
                  emptyText="La edición todavía no subió el video."
                />
              </Block>
            )}
                <CopyBlock video={video} editable={isProd || isEditor} uid={uid} />
                {(video.etapa === "para_publicar" || video.etapa === "publicado") && (
              <PublicacionBlock
                video={video}
                canEdit={isPauta}
                onPauta={() => setPautaOpen(true)}
                onResultados={() => setResultadosOpen(true)}
              />
            )}
                
                <details className="group rounded-xl border px-3 py-2">
                  <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Idea, rodaje y material crudo
                  </summary>
                  <div className="mt-4 space-y-6 pb-2">
                    <IdeaBlock video={video} editable={isProd} uid={uid} />
                <GuionBlock video={video} editable={isProd} />
                    {(rodaje || video.etapa === "planificado") && (
              <Block
                icon={CalendarDays}
                title="Rodaje"
                actions={
                  isProd && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRodajeOpen(true)}>
                      {rodaje ? "Editar" : "Agendar"}
                    </Button>
                  )
                }
              >
                {rodaje ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border p-3 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                      {fechaCorta(rodaje.fecha)} {rodaje.hora ?? ""}
                    </span>
                    {rodaje.lugar && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {rodaje.lugar}
                      </span>
                    )}
                    {rodaje.notas && <p className="w-full text-xs text-muted-foreground">{rodaje.notas}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Todavía sin rodaje agendado.</p>
                )}
              </Block>
            )}
                    <Block icon={Clapperboard} title="Material crudo">
              <MaterialSlot
                video={video}
                slot="crudo"
                clienteNombre={cliente?.nombre ?? "Cliente"}
                canUpload={isProd && ["planificado", "agendado", "material_cliente", "edicion"].includes(video.etapa)}
                emptyText={video.filma_cliente ? "El cliente todavía no subió su material." : "Producción todavía no subió el material filmado."}
              />
            </Block>
                  </div>
                </details>
              </>
            ) : (
              <>
                <IdeaBlock video={video} editable={isProd} uid={uid} />
                <GuionBlock video={video} editable={isProd} />
                {(rodaje || video.etapa === "planificado") && (
              <Block
                icon={CalendarDays}
                title="Rodaje"
                actions={
                  isProd && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRodajeOpen(true)}>
                      {rodaje ? "Editar" : "Agendar"}
                    </Button>
                  )
                }
              >
                {rodaje ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border p-3 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                      {fechaCorta(rodaje.fecha)} {rodaje.hora ?? ""}
                    </span>
                    {rodaje.lugar && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {rodaje.lugar}
                      </span>
                    )}
                    {rodaje.notas && <p className="w-full text-xs text-muted-foreground">{rodaje.notas}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Todavía sin rodaje agendado.</p>
                )}
              </Block>
            )}
                <Block icon={Clapperboard} title="Material crudo">
              <MaterialSlot
                video={video}
                slot="crudo"
                clienteNombre={cliente?.nombre ?? "Cliente"}
                canUpload={isProd && ["planificado", "agendado", "material_cliente", "edicion"].includes(video.etapa)}
                emptyText={video.filma_cliente ? "El cliente todavía no subió su material." : "Producción todavía no subió el material filmado."}
              />
            </Block>
                {!["planificado", "agendado", "material_cliente"].includes(video.etapa) && (
              <Block icon={Film} title="Video final">
                <MaterialSlot
                  video={video}
                  slot="finalizado"
                  clienteNombre={cliente?.nombre ?? "Cliente"}
                  canUpload={(isEditor && video.etapa === "edicion") || isAdmin}
                  emptyText="La edición todavía no subió el video."
                />
              </Block>
            )}
                <CopyBlock video={video} editable={isProd || isEditor} uid={uid} />
              </>
            )}

            <details className="group rounded-xl border px-3 py-2" open={isAdmin}>
              <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Equipo e historial
              </summary>
              <div className="mt-4 space-y-6 pb-2">
            <TeamBlock video={video} editable={isProd} uid={uid} nombre={nombre} />

            {isAdmin && (
              <Block icon={Pencil} title="Admin">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={video.etapa}
                    onValueChange={(v) =>
                      run("forzar", () => forzarEtapa(video, v as EtapaVideo, uid), "Etapa cambiada")
                    }
                  >
                    <SelectTrigger className="h-8 w-56 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ETAPAS.map((e) => (
                        <SelectItem key={e.value} value={e.value}>
                          Mover a: {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-destructive hover:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Eliminar
                  </Button>
                </div>
              </Block>
            )}

            <Block icon={History} title="Historial">
              <ol className="relative space-y-3 border-l pl-4">
                {[...(video.historial ?? [])].reverse().map((h, i) => (
                  <li key={i} className="text-xs">
                    <span className="absolute -left-[4.5px] mt-1 h-2 w-2 rounded-full bg-primary/60" />
                    <p className="font-medium text-foreground">{h.accion}</p>
                    <p className="text-muted-foreground">
                      {nombre(h.by)} · {fechaHora(h.at)}
                    </p>
                    {h.nota && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">“{h.nota}”</p>}
                  </li>
                ))}
              </ol>
            </Block>
              </div>
            </details>
          </>
        )}
      </div>

      {/* Barra de acciones según rol + etapa */}
      <ActionBar>
        {isProd && (video.etapa === "planificado" || video.etapa === "agendado" || video.etapa === "material_cliente") && (
          <>
            {video.etapa === "planificado" && !video.rodaje_id && filma !== "prodi" && (
              <Button
                variant="outline"
                disabled={busy === "filma"}
                onClick={() => run("filma", () => pasarAMaterialCliente(video, cliente, uid), "Le avisamos al cliente que suba su material")}
              >
                <Smartphone className="mr-2 h-4 w-4" /> Lo filma el cliente
              </Button>
            )}
            {video.etapa === "material_cliente" && !hasCrudo && (
              <Button variant="outline" disabled={busy === "filma"} onClick={() => run("filma", () => filmarNosotros(video, uid), "Vuelve a planificado")}>
                <Clapperboard className="mr-2 h-4 w-4" /> Lo filmamos nosotros
              </Button>
            )}
            {video.etapa === "planificado" && (
              <Button variant="outline" onClick={() => setRodajeOpen(true)}>
                <CalendarDays className="mr-2 h-4 w-4" /> Agendar rodaje
              </Button>
            )}
            <Button
              disabled={!hasCrudo || busy === "edicion"}
              onClick={() => (soloPauta(cliente) ? void run("edicion", () => enviarAPauta(video, cliente, uid), "Enviado a pauta") : setEntregaDlg("enviar"))}
              title={!hasCrudo ? (soloPauta(cliente) ? "Primero subí el video que mandó el cliente" : "Primero subí el material crudo") : undefined}
            >
              {busy === "edicion" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {soloPauta(cliente) ? "Enviar a pauta" : "Enviar a edición"}
            </Button>
          </>
        )}

        {isEditor && video.etapa === "edicion" && (
          <Button
            disabled={!hasFinal || busy === "entregar"}
            onClick={() => run("entregar", () => entregarEdicion(video, cliente, uid), "Entregado para revisión")}
            title={!hasFinal ? "Subí el video final primero" : undefined}
          >
            {busy === "entregar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Entregar para revisión
          </Button>
        )}

        {isProd && video.etapa === "revision_interna" && (
          <>
            <Button variant="outline" onClick={() => setNotaOpen("interno")}>
              Pedir cambios
            </Button>
            <Button
              disabled={busy === "aprobar"}
              onClick={() =>
                run("aprobar", () => aprobarInterno(video, cliente, uid), "Enviado al cliente para aprobar")
              }
            >
              {busy === "aprobar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Aprobar y mandar al cliente
            </Button>
          </>
        )}

        {isProd && video.etapa === "revision_cliente" && (
          <Button onClick={() => setLinkOpen(true)}>
            <Link2 className="mr-2 h-4 w-4" /> Link para el cliente
          </Button>
        )}

        {isProd && video.etapa === "revision_cliente" && (
          <Button
            variant="outline"
            disabled={busy === "aprobar_por"}
            onClick={() =>
              run(
                "aprobar_por",
                () => aprobarCliente(video, cliente, uid, null, "Aprobado por el cliente fuera del sistema"),
                "Marcado como aprobado"
              )
            }
          >
            El cliente lo aprobó por otro medio
          </Button>
        )}

        {isCliente && video.etapa === "revision_cliente" && <ClienteActions video={video} onDone={onClose} />}

        {isPauta && video.etapa === "para_publicar" && (
          <Button onClick={() => setPublicarOpen(true)}>
            <Send className="mr-2 h-4 w-4" /> Marcar publicado
          </Button>
        )}

        {isPauta && video.etapa === "publicado" && (
          <Button onClick={() => setResultadosOpen(true)}>
            <TrendingUp className="mr-2 h-4 w-4" /> Cargar resultados
          </Button>
        )}
      </ActionBar>

      <CorreccionesDialog
        video={video}
        open={notaOpen === "interno"}
        onOpenChange={(o) => !o && setNotaOpen(null)}
        title="Pedir cambios a edición"
        description="Pausá en el momento exacto y tocá “Marcar”. La editora ve cada cambio en la línea de tiempo."
        confirmLabel="Mandar a corregir"
        onConfirm={async (nota, marcas) => {
          await pedirCambiosInterno(video, cliente, uid, nota, marcas);
          toast.success("Vuelve a edición con tus cambios");
        }}
      />
      <PublicarDialog video={video} open={publicarOpen} onOpenChange={setPublicarOpen} />
      <LinkClienteDialog video={video} open={linkOpen} onOpenChange={setLinkOpen} />
      <EditarPautaDialog video={video} open={pautaOpen} onOpenChange={setPautaOpen} />
      <ResultadosDialog video={video} open={resultadosOpen} onOpenChange={setResultadosOpen} />
      <RodajeDialog
        open={rodajeOpen}
        onOpenChange={setRodajeOpen}
        clienteId={video.proyecto_id}
        rodaje={rodaje ?? null}
        preseleccion={[video.id]}
      />
      <EntregaEdicionDialog
        video={video}
        open={!!entregaDlg}
        onOpenChange={(v) => !v && setEntregaDlg(null)}
        cambiar={entregaDlg === "cambiar"}
        onConfirmar={(fecha) =>
          run(
            entregaDlg === "cambiar" ? "entrega" : "edicion",
            () => (entregaDlg === "cambiar" ? cambiarEntrega(video, fecha, uid) : enviarAEdicion(video, cliente, uid, fecha)),
            entregaDlg === "cambiar" ? "Fecha de entrega guardada" : "Enviado a edición"
          )
        }
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este video?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra del sistema con su historial. Los archivos de Drive no se tocan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                run("delete", async () => {
                  await eliminarVideo(video);
                  onClose();
                }, "Video eliminado")
              }
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Para el equipo: si al cliente ya le llegó el recordatorio automático de 48 h. */
function RecordatorioCliente({ video }: { video: Video }) {
  const n = video.recordatorios_cliente ?? 0;
  return (
    <p className="flex items-start gap-2 rounded-xl border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
      <BellRing className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
      <span>
        {n === 0
          ? "Si el cliente no lo aprueba en 48 h, le mandamos solos un recordatorio (app, push y correo) con el link para aprobar."
          : `Le recordamos ${n === 1 ? "1 vez" : `${n} veces`} (app, push y correo; el último ${hace(video.recordatorio_cliente_at)}). ${
              n >= 3 ? "Ya no le mandamos más: escribile o llamalo." : "Si sigue sin responder, le avisamos de nuevo en 48 h."
            }`}
      </span>
    </p>
  );
}

function roleNombre(r: string): string {
  return (
    { productor: "producción", editor: "edición", pauta: "pauta", admin: "admin" } as Record<string, string>
  )[r] ?? r;
}

function ActionBar({ children }: { children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t bg-card/95 px-5 py-3 backdrop-blur">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

function IdeaBlock({ video, editable, uid }: { video: Video; editable: boolean; uid: string }) {
  const [editing, setEditing] = useState(false);
  const [titulo, setTitulo] = useState(video.titulo);
  const [idea, setIdea] = useState(video.idea ?? "");
  const [objetivo, setObjetivo] = useState(video.objetivo ?? "");
  const [refs, setRefs] = useState(video.referencias ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setTitulo(video.titulo);
      setIdea(video.idea ?? "");
      setObjetivo(video.objetivo ?? "");
      setRefs(video.referencias ?? "");
    }
  }, [video, editing]);

  const save = async () => {
    if (!titulo.trim()) return;
    setSaving(true);
    try {
      await actualizarVideo(
        video.id,
        { titulo: titulo.trim(), idea: idea || null, objetivo: objetivo || null, referencias: refs || null },
        uid,
        "Idea editada"
      );
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Block
      icon={Sparkles}
      title="Idea"
      actions={
        editable &&
        !editing && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(true)}>
            Editar
          </Button>
        )
      }
    >
      {editing ? (
        <div className="space-y-2">
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          <Textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={4} placeholder="Idea / guion" />
          <Input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Objetivo" />
          <Input value={refs} onChange={(e) => setRefs(e.target.value)} placeholder="Referencias" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          {(video.pedido_cliente || video.fecha_deseada) && (
            <p className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary">
              {video.pedido_cliente ? "Lo pidió el cliente" : "Fecha pedida"}
              {video.fecha_deseada ? ` · lo necesita publicado para el ${fechaCorta(video.fecha_deseada)}` : ""}
            </p>
          )}
          <p className="whitespace-pre-wrap">{video.idea || <span className="text-muted-foreground">Sin guion cargado.</span>}</p>
          {(video.objetivo || video.referencias) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {video.objetivo && <span>Objetivo: <span className="text-foreground">{video.objetivo}</span></span>}
              {video.referencias &&
                (/^https?:\/\/\S+$/.test(video.referencias.trim()) ? (
                  <a href={video.referencias.trim()} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Referencia <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  // Texto con uno o varios links (ej. los que vinieron del sistema anterior).
                  <div className="w-full">
                    <TextoConLinks texto={video.referencias} />
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </Block>
  );
}

function GuionBlock({ video, editable }: { video: Video; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [guion, setGuion] = useState(video.guion ?? "");
  const [tomas, setTomas] = useState((video.tomas ?? []).join("\n"));
  const [busy, setBusy] = useState<null | "ia" | "save">(null);
  const tiene = !!video.guion || (video.tomas?.length ?? 0) > 0;

  useEffect(() => {
    if (!editing) {
      setGuion(video.guion ?? "");
      setTomas((video.tomas ?? []).join("\n"));
    }
  }, [video.guion, video.tomas, editing]);

  const generar = async () => {
    setBusy("ia");
    try {
      await callApi("/api/ia/guion", { video_id: video.id });
      toast.success("Guion y tomas listos. Revisalos y ajustá lo que haga falta.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo generar");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await guardarGuion(video, guion, tomas.split("\n"));
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(null);
    }
  };

  if (!editable && !tiene) return null;

  return (
    <Block
      icon={ListChecks}
      title="Guion y tomas"
      actions={
        editable &&
        !editing && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={generar} disabled={!!busy}>
              {busy === "ia" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {tiene ? "Rehacer con IA" : "Armar con IA"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(true)} disabled={!!busy}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {tiene ? "Editar" : "Escribirlo yo"}
            </Button>
          </div>
        )
      }
    >
      {editing ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Guion</span>
            <Textarea
              value={guion}
              onChange={(e) => setGuion(e.target.value)}
              rows={6}
              autoFocus
              placeholder={"Escena 1: … qué se ve y qué se dice\nEscena 2: …\nCierre: llamado a la acción"}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Tomas para el rodaje (una por línea)</span>
            <Textarea value={tomas} onChange={(e) => setTomas(e.target.value)} rows={5} placeholder={"Plano general del local\nPrimer plano del producto\nTestimonio del dueño"} />
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={!!busy}>
              {busy === "save" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      ) : !tiene ? (
        <p className="text-xs text-muted-foreground">
          Escribilo vos con «Escribirlo yo», o tocá «Armar con IA» y la IA arma el guion por escenas y la lista de tomas a partir de la idea (después lo podés corregir).
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          {video.guion && <p className="whitespace-pre-wrap">{video.guion}</p>}
          {(video.tomas?.length ?? 0) > 0 && (
            <ol className="list-decimal space-y-1 rounded-xl border bg-muted/30 py-2.5 pl-8 pr-3 text-[13px]">
              {video.tomas!.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Block>
  );
}

function LinkClienteDialog({ video, open, onOpenChange }: { video: Video; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { clienteById } = useRedes();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setUrl(null);
    setError(null);
    callApi<{ url: string }>("/api/publico/link", { video_id: video.id })
      .then((r) => setUrl(r.url))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo generar el link"));
  }, [open, video.id]);
  const texto = url
    ? `Hola! Ya está listo el video "${video.titulo}" de ${clienteById(video.proyecto_id)?.nombre ?? "tu marca"}. Miralo y aprobalo (o pedinos cambios) desde acá: ${url}`
    : "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link para que el cliente apruebe</DialogTitle>
          <DialogDescription>
            Lo abre desde el celular, mira el video y lo aprueba sin usuario ni contraseña. Vence en 30 días.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !url ? (
          <Loader2 className="mx-auto my-4 h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-3">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(texto);
                    toast.success("Mensaje copiado");
                  } catch {
                    toast.error("No se pudo copiar: seleccioná el link y copialo a mano");
                  }
                }}
              >
                <Copy className="mr-2 h-4 w-4" /> Copiar mensaje
              </Button>
              <Button asChild>
                <a href={`mailto:?subject=${encodeURIComponent(`Video para aprobar: ${video.titulo}`)}&body=${encodeURIComponent(texto)}`}>
                  <Send className="mr-2 h-4 w-4" /> Mandar por mail
                </a>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CopyBlock({ video, editable, uid }: { video: Video; editable: boolean; uid: string }) {
  const [text, setText] = useState(video.copy ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [opciones, setOpciones] = useState<string[]>([]);

  useEffect(() => {
    if (!dirty) setText(video.copy ?? "");
  }, [video.copy, dirty]);

  const save = async () => {
    setSaving(true);
    try {
      await actualizarVideo(video.id, { copy: text || null }, uid, "Copy actualizado");
      setDirty(false);
      toast.success("Copy guardado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const generar = async () => {
    setGenerating(true);
    try {
      const res = await callApi<{ opciones: string[] }>("/api/ia/copy", { video_id: video.id });
      setOpciones(res.opciones ?? []);
      if (!res.opciones?.length) toast.message("La IA no devolvió opciones. Probá de nuevo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo generar");
    } finally {
      setGenerating(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copy copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  if (!editable) {
    return (
      <Block
        icon={Copy}
        title="Texto del posteo"
        actions={
          text && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={copiar}>
              <Copy className="mr-1 h-3 w-3" /> Copiar
            </Button>
          )
        }
      >
        <p className="whitespace-pre-wrap rounded-xl border bg-muted/30 p-3 text-sm">
          {text || <span className="text-muted-foreground">Sin copy todavía.</span>}
        </p>
      </Block>
    );
  }

  return (
    <Block
      icon={Copy}
      title="Texto del posteo"
      actions={
        <div className="flex gap-1">
          {text && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={copiar}>
              Copiar
            </Button>
          )}
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={generar} disabled={generating}>
            {generating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
            Generar con IA
          </Button>
        </div>
      }
    >
      {opciones.length > 0 && (
        <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/[0.04] p-2">
          <p className="px-1 text-[11px] font-medium text-primary">Elegí una opción (después la podés editar)</p>
          {opciones.map((o, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setText(o);
                setDirty(true);
                setOpciones([]);
              }}
              className="w-full whitespace-pre-wrap rounded-lg border bg-card p-2.5 text-left text-xs hover:border-primary"
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        rows={5}
        placeholder="Texto que acompaña al video en Instagram/Facebook"
      />
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setText(video.copy ?? "");
              setDirty(false);
            }}
          >
            Descartar
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Guardar copy
          </Button>
        </div>
      )}
    </Block>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ResultadosGrid({ video }: { video: Video }) {
  const r = video.resultados;
  if (!r) return <p className="text-xs text-muted-foreground">Todavía sin resultados cargados.</p>;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Alcance" value={formatNum(r.alcance)} />
        <Metric label="Reproducciones" value={formatNum(r.reproducciones)} />
        <Metric label="Mensajes" value={formatNum(r.mensajes)} />
        <Metric label="Interacciones" value={formatNum(r.interacciones)} />
        <Metric label="Clics" value={formatNum(r.clics)} />
        <Metric label="Inversión" value={formatARS(r.gasto)} />
      </div>
      <p className="text-[11px] text-muted-foreground">Actualizado {fechaHora(r.actualizado_at)}</p>
    </div>
  );
}

function PublicacionBlock({
  video,
  canEdit,
  onPauta,
  onResultados,
}: {
  video: Video;
  canEdit: boolean;
  onPauta: () => void;
  onResultados: () => void;
}) {
  const p = video.publicacion;
  const pauta = video.pauta;
  const [sync, setSync] = useState(false);
  const deMeta = video.resultados?.actualizado_por === "meta";
  const traer = async () => {
    setSync(true);
    try {
      await callApi("/api/informes/meta", { video_id: video.id });
      toast.success("Resultados actualizados desde Meta");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Meta no respondió");
    } finally {
      setSync(false);
    }
  };
  return (
    <Block
      icon={TrendingUp}
      title="Publicación y pauta"
      actions={
        canEdit &&
        video.etapa === "publicado" && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onPauta}>
              Pauta
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onResultados}>
              Resultados
            </Button>
          </div>
        )
      }
    >
      {!p ? (
        <p className="text-xs text-muted-foreground">
          Aprobado por el cliente. Falta subirlo a las redes y pautarlo.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {p.link_instagram && <LinkChip href={p.link_instagram} label="Instagram" />}
            {p.link_facebook && <LinkChip href={p.link_facebook} label="Facebook" />}
            {p.link_tiktok && <LinkChip href={p.link_tiktok} label="TikTok" />}
            <span className="self-center text-xs text-muted-foreground">
              {p.sube_cliente ? `Entregado al cliente el ${fechaCorta(p.publicado_at)}: lo sube él` : `Publicado ${fechaCorta(p.publicado_at)}`}
            </span>
          </div>
          {pauta && (
            <div className="rounded-xl border p-3 text-xs">
              <p className="font-medium">
                {pauta.activa ? "Pauta activa" : "Sin pauta"}
                {pauta.objetivo ? ` · ${pauta.objetivo}` : ""}
              </p>
              {pauta.activa && (
                <p className="mt-0.5 text-muted-foreground">
                  {formatARS(pauta.presupuesto)} · {fechaCorta(pauta.inicio)} → {pauta.fin ? fechaCorta(pauta.fin) : "sin fecha de fin"}
                </p>
              )}
            </div>
          )}
          <ResultadosGrid video={video} />
          {video.meta?.ad_id ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {deMeta && video.resultados ? `Traído de Meta ${fechaHora(video.resultados.actualizado_at)}` : "Conectado a Meta"} · se
                actualiza solo todos los días
              </span>
              {canEdit && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={traer} disabled={sync}>
                  {sync ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                  Actualizar ahora
                </Button>
              )}
            </div>
          ) : (
            canEdit && (
              <p className="text-[11px] text-muted-foreground">
                Cargá el ID del anuncio en “Pauta” y los resultados se traen solos de Meta.
              </p>
            )
          )}
        </div>
      )}
    </Block>
  );
}

function LinkChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
    >
      {label} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function TeamBlock({
  video,
  editable,
  uid,
  nombre,
}: {
  video: Video;
  editable: boolean;
  uid: string;
  nombre: (id: string | null | undefined) => string;
}) {
  const { profiles } = useAppData();
  const opciones = (rol: string) => profiles.filter((p) => p.role === rol || p.role === "admin");
  const fila = (label: string, field: "productor_id" | "editor_id" | "pauta_id", rol: string) => (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {editable ? (
        <Select
          value={video[field] ?? "none"}
          onValueChange={(v) =>
            void actualizarVideo(video.id, { [field]: v === "none" ? null : v }, uid, `${label} reasignado`)
          }
        >
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin asignar</SelectItem>
            {opciones(rol).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-sm">{nombre(video[field])}</span>
      )}
    </div>
  );
  return (
    <Block icon={Users} title="Equipo">
      <div className="space-y-2 rounded-xl border p-3">
        {fila("Producción", "productor_id", "productor")}
        {fila("Edición", "editor_id", "editor")}
        {fila("Pauta", "pauta_id", "pauta")}
      </div>
    </Block>
  );
}

// ---------------------------------------------------------------------------
// Vista del cliente
// ---------------------------------------------------------------------------

function ClienteView({ video }: { video: Video }) {
  const { clienteById } = useRedes();
  const cliente = clienteById(video.proyecto_id);
  const visibleFinal = ["revision_cliente", "para_publicar", "publicado"].includes(video.etapa);

  return (
    <>
      {video.etapa === "revision_cliente" && (
        <ol className="space-y-1.5 rounded-xl border border-primary/30 bg-primary/[0.06] p-3 text-sm">
          {["Mirá el video completo.", "Leé el texto que va a acompañar la publicación.", "Abajo: tocá “Aprobar” o “Pedir cambios” y contanos qué."].map((t, i) => (
            <li key={t} className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {i + 1}
              </span>
              {t}
            </li>
          ))}
        </ol>
      )}
      {visibleFinal ? (
        <Block icon={Film} title="Video">
          <MaterialSlot
            video={video}
            slot="finalizado"
            clienteNombre={cliente?.nombre ?? ""}
            canUpload={false}
            audience="client"
          />
        </Block>
      ) : video.etapa === "material_cliente" ? null : (
        <div className="rounded-xl border p-4 text-sm text-muted-foreground">
          Estamos trabajando en este video ({etapaInfo(video.etapa).clienteLabel.toLowerCase()}). Te avisamos
          cuando esté listo para que lo veas.
        </div>
      )}
      {aceptaMaterialCliente(video, cliente) && (
        <Block icon={Clapperboard} title={video.etapa === "material_cliente" ? "Tu material" : "Material extra"}>
          <SubirMaterial video={video} />
        </Block>
      )}
      {video.idea && (
        <Block icon={Sparkles} title="Idea">
          <p className="whitespace-pre-wrap text-sm">{video.idea}</p>
        </Block>
      )}
      {!visibleFinal && video.material_base?.tipo === "existente" && (
        <Block icon={FolderOpen} title="El material que elegiste">
          <MaterialElegido video={video} audience="client" />
        </Block>
      )}
      {visibleFinal && video.copy && (
        <Block icon={Copy} title="Texto del posteo">
          <p className="whitespace-pre-wrap rounded-xl border bg-muted/30 p-3 text-sm">{video.copy}</p>
        </Block>
      )}
      {video.etapa === "publicado" && (
        <Block icon={TrendingUp} title="Resultados">
          <div className="mb-2 flex flex-wrap gap-2">
            {video.publicacion?.link_instagram && <LinkChip href={video.publicacion.link_instagram} label="Ver en Instagram" />}
            {video.publicacion?.link_facebook && <LinkChip href={video.publicacion.link_facebook} label="Ver en Facebook" />}
          </div>
          <ResultadosGrid video={video} />
        </Block>
      )}
    </>
  );
}

function ClienteActions({ video, onDone }: { video: Video; onDone: () => void }) {
  const { user } = useUserProfileContext();
  const { clienteById } = useRedes();
  const cliente = clienteById(video.proyecto_id);
  const [rating, setRating] = useState(0);
  const [cambiosOpen, setCambiosOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const uid = user?.uid ?? "";

  const aprobar = async () => {
    setSaving(true);
    try {
      await aprobarCliente(video, cliente, uid, rating || null);
      toast.success("¡Gracias! Lo publicamos y te avisamos.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo aprobar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">¿Qué te pareció?</span>
        <StarRating value={rating} onChange={setRating} size="md" />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setCambiosOpen(true)}>
          Pedir cambios
        </Button>
        <Button onClick={aprobar} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Aprobar
        </Button>
      </div>
      <CorreccionesDialog
        video={video}
        open={cambiosOpen}
        onOpenChange={setCambiosOpen}
        title="¿Qué querés cambiar?"
        description="Pausá el video donde querés el cambio y tocá “Marcar”. Así lo corregimos justo ahí."
        placeholder="Ej.: usar otra música, el logo más grande…"
        confirmLabel="Enviar cambios"
        onConfirm={async (nota, marcas) => {
          await pedirCambiosCliente(video, cliente, uid, nota, rating || null, marcas);
          toast.success("Recibimos tus cambios. Te avisamos cuando esté corregido.");
          onDone();
        }}
      />
    </div>
  );
}

