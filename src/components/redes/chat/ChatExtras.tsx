// Herramientas del chat: buscar con salto al mensaje, galería (fotos, videos, archivos, links), mensajes fijados,
// encuestas rápidas, reenviar y mensajes programados.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  File as FileIcon,
  Images,
  Link2,
  Pencil,
  Loader2,
  Pin,
  Play,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ChatIcon } from "@/components/redes/chat/ChatIcon";
import { peso, urlArchivo } from "@/components/redes/chat/Archivo";
import { descargarArchivo } from "@/utils/drive/driveMediaUrl";
import {
  cancelarProgramado,
  editarProgramado,
  mandarEncuesta,
  programarMensaje,
  reenviarMensaje,
  resumenMensaje,
  tituloChat,
  votarEncuesta,
  type Programado,
} from "@/lib/redes/chat";
import { cn } from "@/lib/utils";
import type { Profile } from "@/integrations/firebase/types";
import type { Chat, Mensaje } from "@/lib/redes/types";

const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Los últimos mensajes del chat (para buscar y para la galería; más de los que hay en pantalla). */
async function historial(chatId: string, n = 1500): Promise<Mensaje[]> {
  const s = await getDocs(query(collection(db, "chats", chatId, "mensajes"), orderBy("at", "desc"), limit(n)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }) as Mensaje);
}

const hora = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---------------------------------------------------------------------------
// Buscar dentro del chat
// ---------------------------------------------------------------------------

export function BuscarEnChat({
  chat,
  nombreDe,
  onIr,
  onCerrar,
}: {
  chat: Chat;
  nombreDe: (uid: string, porDefecto?: string) => string;
  onIr: (id: string) => void;
  onCerrar: () => void;
}) {
  const [q, setQ] = useState("");
  const [todos, setTodos] = useState<Mensaje[] | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    void historial(chat.id).then(setTodos).catch(() => setTodos([]));
  }, [chat.id]);
  const res = useMemo(() => {
    const b = normal(q.trim());
    if (b.length < 2 || !todos) return [];
    return todos.filter((m) => m.tipo !== "sistema" && normal(`${m.texto ?? ""} ${m.leyenda ?? ""} ${m.archivo?.name ?? ""}`).includes(b));
  }, [q, todos]);
  // El primer Enter va al primero; los siguientes, al próximo (Shift+Enter, al anterior).
  const navegando = useRef(false);
  useEffect(() => {
    setI(0);
    navegando.current = false;
  }, [q]);
  const ir = (k: number) => {
    if (!res.length) return;
    const n = (k + res.length) % res.length;
    setI(n);
    onIr(res[n].id);
  };
  return (
    <div className="shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur animate-in fade-in slide-in-from-top-1">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                ir(!navegando.current ? i : e.shiftKey ? i - 1 : i + 1);
                navegando.current = true;
              }
              if (e.key === "Escape") onCerrar();
            }}
            placeholder="Buscar en este chat…"
            className="h-10 rounded-full bg-muted/60 pl-9"
          />
        </div>
        <span className="w-14 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
          {todos === null ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : q.trim().length >= 2 ? (res.length ? `${i + 1} de ${res.length}` : "0") : ""}
        </span>
        <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full" disabled={!res.length} onClick={() => ir(i - 1)} aria-label="Anterior">
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full" disabled={!res.length} onClick={() => ir(i + 1)} aria-label="Siguiente">
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full" onClick={onCerrar} aria-label="Cerrar búsqueda">
          <X className="h-4 w-4" />
        </Button>
      </div>
      {res.length > 0 && (
        <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
          {res.slice(0, 50).map((m, k) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setI(k);
                onIr(m.id);
              }}
              className={cn("block w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted", k === i && "bg-primary/10")}
            >
              <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate font-medium">{nombreDe(m.by, m.by_nombre)}</span>
                <span className="shrink-0">{hora(m.at)}</span>
              </span>
              <span className="line-clamp-1">{resumenMensaje(m)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mensajes fijados
// ---------------------------------------------------------------------------

export function FijadosChat({ chat, onIr, onSacar }: { chat: Chat; onIr: (id: string) => void; onSacar: (id: string) => void }) {
  const [k, setK] = useState(0);
  const fijados = chat.fijados ?? [];
  if (!fijados.length) return null;
  const f = fijados[k % fijados.length];
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-primary/[0.05] px-3 py-1.5">
      {fijados.length > 1 && (
        <span className="flex shrink-0 flex-col gap-0.5" aria-hidden>
          {fijados.map((x, j) => (
            <span key={x.id} className={cn("h-2.5 w-0.5 rounded-full", j === k % fijados.length ? "bg-primary" : "bg-primary/25")} />
          ))}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          onIr(f.id);
          setK((x) => x + 1);
        }}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Pin className="h-4 w-4 shrink-0 rotate-45 text-primary" />
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold text-primary">Fijado{fijados.length > 1 ? ` · ${(k % fijados.length) + 1} de ${fijados.length}` : ""}</span>
          <span className="block truncate text-sm">{f.texto}</span>
        </span>
      </button>
      <button type="button" onClick={() => onSacar(f.id)} className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Desfijar" title="Desfijar">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Galería del chat
// ---------------------------------------------------------------------------

const LINK = /https?:\/\/[^\s<>"')\]]+/gi;
type Pestaña = "fotos" | "videos" | "archivos" | "links";

function Miniatura({ fileId, onClick, video }: { fileId: string; onClick: () => void; video?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!video) void urlArchivo(fileId).then((u) => vivo && setUrl(u)).catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [fileId, video]);
  return (
    <button type="button" onClick={onClick} className="relative aspect-square overflow-hidden rounded-lg bg-muted transition-opacity hover:opacity-85">
      {url && <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />}
      {!url && !video && <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin text-muted-foreground" />}
      {video && (
        <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900">
          <Play className="h-7 w-7 fill-white text-white" />
        </span>
      )}
    </button>
  );
}

export function GaleriaChat({ chat, open, onOpenChange, onIr }: { chat: Chat; open: boolean; onOpenChange: (v: boolean) => void; onIr: (id: string) => void }) {
  const [tab, setTab] = useState<Pestaña>("fotos");
  const [msjs, setMsjs] = useState<Mensaje[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setMsjs(null);
    void historial(chat.id, 2000).then(setMsjs).catch(() => setMsjs([]));
  }, [open, chat.id]);
  const archivos = (msjs ?? []).filter((m) => m.tipo === "archivo" && m.archivo);
  const fotos = archivos.filter((m) => /^image\//.test(m.archivo!.mime_type) && !m.archivo!.documento);
  const videos = archivos.filter((m) => /^video\//.test(m.archivo!.mime_type));
  const docs = archivos.filter((m) => !fotos.includes(m) && !videos.includes(m));
  const links = (msjs ?? []).flatMap((m) => [...new Set((m.texto ?? "").match(LINK) ?? [])].map((url) => ({ m, url })));
  const ir = (id: string) => {
    onOpenChange(false);
    setTimeout(() => onIr(id), 250);
  };
  const pestañas: { v: Pestaña; label: string; n: number }[] = [
    { v: "fotos", label: "Fotos", n: fotos.length },
    { v: "videos", label: "Videos", n: videos.length },
    { v: "archivos", label: "Archivos", n: docs.length },
    { v: "links", label: "Links", n: links.length },
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 pb-3 pt-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <Images className="h-5 w-5 text-primary" /> Fotos, videos y archivos
          </SheetTitle>
          <div className="mt-2 grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
            {pestañas.map((p) => (
              <button
                key={p.v}
                type="button"
                onClick={() => setTab(p.v)}
                className={cn("rounded-lg px-1 py-1.5 text-xs font-medium transition-colors", tab === p.v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {p.label} <span className="opacity-60">{msjs ? p.n : ""}</span>
              </button>
            ))}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {msjs === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tab === "fotos" || tab === "videos" ? (
            (tab === "fotos" ? fotos : videos).length ? (
              <div className="grid grid-cols-3 gap-1.5">
                {(tab === "fotos" ? fotos : videos).map((m) => (
                  <Miniatura key={m.id} fileId={m.archivo!.drive_file_id} video={tab === "videos"} onClick={() => ir(m.id)} />
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Todavía no hay {tab} en este chat.</p>
            )
          ) : tab === "archivos" ? (
            docs.length ? (
              <div className="space-y-1">
                {docs.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/60">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileIcon className="h-5 w-5" />
                    </span>
                    <button type="button" onClick={() => ir(m.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium">{m.archivo!.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {m.archivo!.size ? `${peso(m.archivo!.size)} · ` : ""}
                        {hora(m.at)}
                      </span>
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 rounded-full"
                      onClick={() => void descargarArchivo(m.archivo!.drive_file_id, m.archivo!.name).catch(() => toast.error("No se pudo bajar"))}
                      aria-label="Descargar"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Todavía no hay archivos en este chat.</p>
            )
          ) : links.length ? (
            <div className="space-y-1">
              {links.map(({ m, url }, k) => (
                <div key={`${m.id}-${k}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/60">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
                    <Link2 className="h-5 w-5" />
                  </span>
                  <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-primary">{url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                    <span className="text-[11px] text-muted-foreground">{hora(m.at)}</span>
                  </a>
                  <button type="button" onClick={() => ir(m.id)} className="shrink-0 rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
                    Ver en el chat
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Todavía no hay links en este chat.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Encuestas
// ---------------------------------------------------------------------------

export function EncuestaMensaje({ chat, m, uid, mio, nombreDe }: { chat: Chat; m: Mensaje; uid: string; mio: boolean; nombreDe: (uid: string) => string }) {
  const e = m.encuesta!;
  const votos = m.votos ?? {};
  const total = Object.keys(votos).length;
  const mios = votos[uid] ?? [];
  const cuenta = e.opciones.map((_, i) => Object.values(votos).filter((v) => v.includes(i)).length);
  const max = Math.max(1, ...cuenta);
  const [verQuien, setVerQuien] = useState(false);
  return (
    <div className="min-w-[230px] space-y-2">
      <p className="flex items-start gap-1.5 font-semibold">
        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0" /> {e.pregunta}
      </p>
      <p className={cn("text-[11px]", mio ? "text-primary-foreground/70" : "text-muted-foreground")}>{e.multiple ? "Podés elegir varias" : "Elegí una"}</p>
      <div className="space-y-1.5">
        {e.opciones.map((o, i) => {
          const elegida = mios.includes(i);
          const pct = total ? Math.round((cuenta[i] / total) * 100) : 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => void votarEncuesta(chat, m, uid, i).catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo votar"))}
              className={cn(
                "relative w-full overflow-hidden rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                mio ? "border-white/30 hover:bg-white/10" : "bg-background/60 hover:border-primary/50",
                elegida && (mio ? "border-white bg-white/15" : "border-primary")
              )}
            >
              <span
                className={cn("absolute inset-y-0 left-0 transition-all duration-500", mio ? "bg-white/20" : "bg-primary/15", cuenta[i] === max && total > 0 && !mio && "bg-primary/25")}
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                      e.multiple && "rounded-md",
                      elegida ? (mio ? "border-white bg-white" : "border-primary bg-primary") : mio ? "border-white/60" : "border-muted-foreground/40"
                    )}
                  />
                  <span className="min-w-0 break-words">{o}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums">{cuenta[i]}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => setVerQuien((v) => !v)} className={cn("text-[11px] underline-offset-2 hover:underline", mio ? "text-primary-foreground/80" : "text-muted-foreground")}>
        {total === 0 ? "Nadie votó todavía" : `${total} ${total === 1 ? "voto" : "votos"} · ${verQuien ? "ocultar" : "ver quién votó"}`}
      </button>
      {verQuien && total > 0 && (
        <div className={cn("space-y-1 rounded-lg p-2 text-[11px]", mio ? "bg-white/10" : "bg-muted/60")}>
          {e.opciones.map((o, i) => {
            const quienes = Object.entries(votos)
              .filter(([, v]) => v.includes(i))
              .map(([u]) => (u === uid ? "Vos" : nombreDe(u).split(" ")[0]));
            return quienes.length ? (
              <p key={i}>
                <b>{o}:</b> {quienes.join(", ")}
              </p>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

/** Ejemplos de un toque: completan la pregunta y las opciones. */
const EJEMPLOS_ENCUESTA: { pregunta: string; opciones: string[] }[] = [
  { pregunta: "¿Qué portada va?", opciones: ["La 1", "La 2", "La 3"] },
  { pregunta: "¿Qué día filmamos?", opciones: ["Lunes", "Miércoles", "Viernes"] },
  { pregunta: "¿Cuál te gusta más?", opciones: ["Opción A", "Opción B"] },
  { pregunta: "¿Lo publicamos así?", opciones: ["Sí, va", "No, cambiemos algo"] },
];
/** Color de cada opción (A, B, C…). */
const TONOS_OPCION = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-pink-500", "bg-indigo-500", "bg-teal-500", "bg-orange-500", "bg-fuchsia-500", "bg-lime-600"];

export function CrearEncuesta({ chat, uid, remitente, open, onOpenChange }: { chat: Chat; uid: string; remitente: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [pregunta, setPregunta] = useState("");
  const [ops, setOps] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    if (!open) return;
    setPregunta("");
    setOps(["", ""]);
    setMultiple(false);
  }, [open]);
  const validas = ops.filter((o) => o.trim()).length;
  const listo = !!pregunta.trim() && validas >= 2;
  const enfocar = (i: number) => setTimeout(() => refs.current[i]?.focus(), 30);
  const mandar = async () => {
    setEnviando(true);
    try {
      await mandarEncuesta(chat, uid, remitente, pregunta, ops, multiple);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mandar");
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] max-w-md flex-col gap-0 overflow-hidden rounded-3xl p-0">
        {/* Encabezado con color (el mismo de "Encuesta" en el clip). */}
        <div className="relative overflow-hidden bg-gradient-to-br from-amber-400 to-orange-500 px-5 pb-4 pt-5 text-white">
          <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15" />
          <DialogHeader className="relative space-y-1 text-left">
            <DialogTitle className="flex items-center gap-2.5 text-lg text-white">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/25">
                <BarChart3 className="h-5 w-5" />
              </span>
              Encuesta rápida
            </DialogTitle>
            <DialogDescription className="text-white/85">Cada uno vota y el resultado se ve al instante.</DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            <textarea
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value.slice(0, 200))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enfocar(0);
                }
              }}
              rows={2}
              placeholder="¿Qué querés preguntar?"
              className="w-full resize-none rounded-2xl border-2 border-orange-500/30 bg-orange-500/[0.06] px-4 py-3 text-base font-semibold outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground focus:border-orange-500"
            />
            {!pregunta && (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {EJEMPLOS_ENCUESTA.map((e) => (
                  <button
                    key={e.pregunta}
                    type="button"
                    onClick={() => {
                      setPregunta(e.pregunta);
                      setOps(e.opciones);
                    }}
                    className="shrink-0 rounded-full border bg-muted/50 px-3 py-1.5 text-xs font-medium transition-colors hover:border-orange-500/50 hover:bg-orange-500/10"
                  >
                    {e.pregunta}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opciones</p>
            {ops.map((o, i) => (
              <div key={i} className="flex items-center gap-2 rounded-2xl border bg-card px-2 py-1.5 transition-colors focus-within:border-orange-500/60">
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", TONOS_OPCION[i % TONOS_OPCION.length])}>
                  {String.fromCharCode(65 + i)}
                </span>
                <input
                  ref={(el) => (refs.current[i] = el)}
                  value={o}
                  onChange={(e) => setOps((xs) => xs.map((x, j) => (j === i ? e.target.value.slice(0, 100) : x)))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    // Enter: a la próxima opción (o se suma una nueva al final).
                    if (i < ops.length - 1) enfocar(i + 1);
                    else if (o.trim() && ops.length < 10) {
                      setOps((xs) => [...xs, ""]);
                      enfocar(i + 1);
                    }
                  }}
                  placeholder={`Opción ${String.fromCharCode(65 + i)}`}
                  className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                />
                {ops.length > 2 && (
                  <button type="button" onClick={() => setOps((xs) => xs.filter((_, j) => j !== i))} className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Quitar opción">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {ops.length < 10 && (
              <button
                type="button"
                onClick={() => {
                  setOps((xs) => [...xs, ""]);
                  enfocar(ops.length);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-orange-500/40 py-2.5 text-sm font-semibold text-orange-600 transition-colors hover:bg-orange-500/10 dark:text-orange-400"
              >
                <Plus className="h-4 w-4" /> Agregar opción
              </button>
            )}
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-muted/50 px-4 py-3">
            <span>
              <span className="block text-sm font-medium">Elegir varias</span>
              <span className="block text-xs text-muted-foreground">{multiple ? "Cada uno puede marcar más de una" : "Cada uno elige una sola"}</span>
            </span>
            <Switch checked={multiple} onCheckedChange={setMultiple} />
          </label>
        </div>

        <div className="border-t px-5 py-3">
          <Button
            onClick={() => void mandar()}
            disabled={enviando || !listo}
            className="h-12 w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-base font-semibold text-white shadow-lg shadow-orange-500/25 hover:opacity-95 disabled:opacity-50"
          >
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {listo ? "Mandar encuesta" : !pregunta.trim() ? "Escribí la pregunta" : "Poné al menos 2 opciones"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reenviar
// ---------------------------------------------------------------------------

export function ReenviarMensaje({
  chat,
  m,
  chats,
  uid,
  profiles,
  role,
  onOpenChange,
}: {
  chat: Chat;
  m: Mensaje | null;
  chats: Chat[];
  uid: string;
  profiles: Profile[];
  role?: string;
  onOpenChange: (v: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (!m) return;
    setQ("");
    setElegidos([]);
  }, [m]);
  const lista = useMemo(
    () =>
      chats
        .filter((c) => c.id !== chat.id && c.tipo !== "prodi" && c.miembros?.includes(uid))
        .map((c) => ({ c, nombre: tituloChat(c, uid, profiles, role) }))
        .filter((x) => !q.trim() || normal(x.nombre).includes(normal(q.trim())))
        .sort((a, b) => (b.c.ultimo?.at ?? "").localeCompare(a.c.ultimo?.at ?? ""))
        .slice(0, 40),
    [chats, chat.id, uid, profiles, role, q]
  );
  const mandar = async () => {
    if (!m) return;
    setEnviando(true);
    try {
      await reenviarMensaje(chat, m, elegidos);
      toast.success(elegidos.length === 1 ? "Reenviado" : `Reenviado a ${elegidos.length} chats`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo reenviar");
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Dialog open={!!m} onOpenChange={(v) => !enviando && onOpenChange(v)}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle>Reenviar a…</DialogTitle>
          <DialogDescription className="line-clamp-2">{m ? resumenMensaje(m) : ""}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona o grupo…" className="pl-9" />
        </div>
        <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
          {lista.map(({ c, nombre }) => {
            const sel = elegidos.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setElegidos((xs) => (sel ? xs.filter((x) => x !== c.id) : xs.length >= 5 ? xs : [...xs, c.id]))}
                className={cn("flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-all", sel ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/60")}
              >
                <ChatIcon chat={c} profiles={profiles} uid={uid} className="h-9 w-9" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{nombre}</span>
                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", sel ? "border-primary bg-primary" : "border-muted-foreground/30")} />
              </button>
            );
          })}
          {lista.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No hay chats con ese nombre.</p>}
        </div>
        <Button onClick={() => void mandar()} disabled={!elegidos.length || enviando} className="w-full">
          {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {elegidos.length > 1 ? `Reenviar a ${elegidos.length} chats` : "Reenviar"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Mensajes programados
// ---------------------------------------------------------------------------

/** Los míos programados para este chat (se ven arriba de la caja y se pueden cancelar). */
export function useProgramados(chatId: string, uid: string): Programado[] {
  const [lista, setLista] = useState<Programado[]>([]);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "programados"), where("by", "==", uid)),
        (s) =>
          setLista(
            s.docs
              .map((d) => ({ id: d.id, ...d.data() }) as Programado)
              .filter((p) => p.chat_id === chatId)
              .sort((a, b) => a.enviar_at.localeCompare(b.enviar_at))
          ),
        () => setLista([])
      ),
    [chatId, uid]
  );
  return lista;
}

export function ProgramadosChat({ lista, onEditar }: { lista: Programado[]; onEditar: (p: Programado) => void }) {
  const [abierto, setAbierto] = useState(false);
  if (!lista.length) return null;
  return (
    <div className="shrink-0 border-t bg-amber-500/[0.06] px-3 py-1.5">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center gap-2 text-left text-xs font-medium text-amber-700 dark:text-amber-300">
        <CalendarClock className="h-3.5 w-3.5" />
        {lista.length === 1 ? "1 mensaje programado" : `${lista.length} mensajes programados`} · sale el {hora(lista[0].enviar_at)}
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", abierto && "rotate-180")} />
      </button>
      {abierto && (
        <div className="mt-1.5 space-y-1">
          {lista.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg bg-background px-2.5 py-1.5 text-sm">
              <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-[11px] text-muted-foreground">{hora(p.enviar_at)}</span>
              <button type="button" onClick={() => onEditar(p)} className="min-w-0 flex-1 truncate text-left hover:underline" title="Editar">
                {p.texto}
              </button>
              <button
                type="button"
                onClick={() => onEditar(p)}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Editar"
                title="Editar"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void cancelarProgramado(p.id).then(() => toast.success("Cancelado"))}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                aria-label="Cancelar"
                title="Cancelar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Elegir para cuándo: atajos (en 1 h, mañana 9 h, lunes 9 h) o fecha y hora a mano. */
export function ProgramarMensaje({
  chat,
  uid,
  remitente,
  texto,
  open,
  onOpenChange,
  onListo,
  editando,
  aLaManana,
}: {
  chat: Chat;
  uid: string;
  remitente: string;
  texto: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onListo: () => void;
  /** Con un programado: se edita ese (texto y hora). */
  editando?: Programado | null;
  /** De noche: viene elegida la hora en que termina el descanso del equipo (ej. mañana 8:00). */
  aLaManana?: { hasta: number; domingo: boolean } | null;
}) {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [dia, setDia] = useState(iso(new Date()));
  const [hh, setHh] = useState("09:00");
  const [guardando, setGuardando] = useState(false);
  // El mensaje se escribe acá (si ya había algo en la caja del chat, viene cargado).
  const [msj, setMsj] = useState("");
  useEffect(() => {
    if (!open) return;
    if (editando) {
      const d = new Date(editando.enviar_at);
      setMsj(editando.texto);
      setDia(iso(d));
      setHh(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    } else {
      setMsj(texto);
      if (aLaManana) {
        // La próxima mañana a la hora en que termina el descanso (saltea el domingo si descansan ese día).
        const d = new Date();
        if (d.getHours() >= aLaManana.hasta) d.setDate(d.getDate() + 1);
        if (aLaManana.domingo && d.getDay() === 0) d.setDate(d.getDate() + 1);
        setDia(iso(d));
        setHh(`${String(aLaManana.hasta).padStart(2, "0")}:00`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, texto, editando?.id]);
  const atajos = useMemo(() => {
    const ahora = new Date();
    const enUnaHora = new Date(ahora.getTime() + 60 * 60_000);
    const manana = new Date(ahora);
    manana.setDate(manana.getDate() + 1);
    manana.setHours(9, 0, 0, 0);
    const lunes = new Date(ahora);
    lunes.setDate(lunes.getDate() + (((8 - lunes.getDay()) % 7) || 7));
    lunes.setHours(9, 0, 0, 0);
    return [
      { label: "En 1 hora", d: enUnaHora },
      { label: "Mañana 9:00", d: manana },
      { label: "Lunes 9:00", d: lunes },
    ];
  }, [open]);
  const programar = async (d: Date) => {
    if (!msj.trim()) {
      toast.error("Escribí el mensaje que querés programar");
      return;
    }
    setGuardando(true);
    try {
      if (editando) {
        await editarProgramado(editando.id, msj, d);
        toast.success(`Listo: sale el ${hora(d.toISOString())}`);
      } else {
        await programarMensaje(chat, uid, remitente, msj, d);
        toast.success(`Programado para el ${hora(d.toISOString())}`);
        onListo();
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo programar");
    } finally {
      setGuardando(false);
    }
  };
  const personalizada = new Date(`${dia}T${hh}:00`);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] max-w-md flex-col gap-0 overflow-hidden rounded-3xl p-0">
        {/* Encabezado con color (el mismo de "Programar" en el clip). */}
        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-400 to-teal-600 px-5 pb-4 pt-5 text-white">
          <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15" />
          <DialogHeader className="relative space-y-1 text-left">
            <DialogTitle className="flex items-center gap-2.5 text-lg text-white">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/25">
                <CalendarClock className="h-5 w-5" />
              </span>
              {editando ? "Editar mensaje programado" : "Programar mensaje"}
            </DialogTitle>
            <DialogDescription className="text-white/85">
              {editando ? "Cambiá el texto o la hora. Todavía no salió." : "Escribilo ahora y sale solo, a tu nombre, a la hora que elijas."}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <textarea
            value={msj}
            onChange={(e) => setMsj(e.target.value.slice(0, 4000))}
            rows={3}
            autoFocus={!texto}
            placeholder="Ej.: Buen día, les recuerdo que hoy filmamos a las 10"
            className="w-full resize-none rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-[15px] outline-none transition-colors placeholder:text-muted-foreground focus:border-emerald-500"
          />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">¿Cuándo sale?</p>
            <div className="grid grid-cols-3 gap-2">
              {atajos.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  disabled={guardando || !msj.trim()}
                  onClick={() => void programar(a.d)}
                  className="flex flex-col items-center gap-1 rounded-2xl border bg-card px-2 py-3 text-center transition-all hover:-translate-y-0.5 hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:pointer-events-none disabled:opacity-50"
                >
                  <Clock className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs font-semibold">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 rounded-2xl bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">U otro día y hora</p>
            <div className="flex items-center gap-2">
              <Input type="date" value={dia} min={iso(new Date())} onChange={(e) => setDia(e.target.value)} className="h-11 rounded-xl bg-background" />
              <Input type="time" value={hh} onChange={(e) => setHh(e.target.value)} className="h-11 w-28 rounded-xl bg-background" />
            </div>
          </div>
        </div>
        <div className="space-y-2 border-t px-5 py-3">
          <Button
            onClick={() => void programar(personalizada)}
            disabled={guardando || !dia || !hh || !msj.trim()}
            className="h-12 w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-600 text-base font-semibold text-white shadow-lg shadow-emerald-500/25 hover:opacity-95 disabled:opacity-50"
          >
            {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            {!msj.trim() ? "Escribí el mensaje" : `${editando ? "Guardar: sale el" : "Programar para el"} ${hora(personalizada.toISOString())}`}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">Hasta que salga, lo ves arriba de la caja de texto y lo podés cancelar.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
