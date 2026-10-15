import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  Check,
  Clapperboard,
  FileText,
  Forward,
  HandCoins,
  Hand,
  Images,
  LayoutGrid,
  ListTodo,
  MapPin,
  MessageCircle,
  MonitorUp,
  Pencil,
  Pin,
  Play,
  Receipt,
  RefreshCw,
  Reply,
  Search,
  Send,
  Sparkles,
  Timer,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import type { AnimRecorrido } from "@/lib/novedades";
import { cn } from "@/lib/utils";

/** Marco común: una "pantallita" con fondo suave donde pasa la animación. */
function Pantalla({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative mx-auto flex h-44 w-full max-w-xs items-center justify-center overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/[0.10] via-background to-primary/[0.04]", className)}>
      {children}
    </div>
  );
}

const Burbuja = ({ children, mia, className }: { children: React.ReactNode; mia?: boolean; className?: string }) => (
  <div className={cn("w-fit max-w-[80%] rounded-2xl px-3 py-1.5 text-xs shadow-sm", mia ? "ml-auto rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card", className)}>{children}</div>
);

const Dedo = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <span className={cn("tour-dedo pointer-events-none absolute text-primary drop-shadow", className)} style={style}>
    <Hand className="h-6 w-6 fill-background" />
  </span>
);

function Deslizar() {
  return (
    <Pantalla>
      <div className="relative w-56">
        <span className="tour-flecha absolute left-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Reply className="h-3.5 w-3.5" />
        </span>
        <div className="tour-deslizar">
          <Burbuja>¿Mañana filmamos a las 10?</Burbuja>
        </div>
      </div>
    </Pantalla>
  );
}

function Mencionar() {
  return (
    <Pantalla className="items-end pb-4">
      <div className="w-60 space-y-2">
        <div className="tour-aparecer space-y-1 rounded-xl border bg-popover p-1.5 text-xs shadow-lg">
          <div className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">N</span> Nati
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-muted-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">L</span> Lucía
          </div>
        </div>
        <div className="rounded-full border bg-background px-3 py-1.5 text-xs">
          <span className="tour-escribir inline-block align-bottom" style={{ "--ancho": "12ch" } as React.CSSProperties}>
            <b className="text-primary">@Nati</b> mirá esto
          </span>
        </div>
      </div>
    </Pantalla>
  );
}

function Reaccionar() {
  return (
    <Pantalla>
      <div className="relative w-56 space-y-2">
        <div className="tour-aparecer mx-auto flex w-fit gap-1 rounded-full border bg-popover px-2 py-1 text-base shadow-lg">
          {["👍", "❤️", "😂", "✅", "🙏"].map((e) => (
            <span key={e}>{e}</span>
          ))}
        </div>
        <Burbuja>Ya subí el crudo de DS 🎬</Burbuja>
        <Dedo className="left-16 top-14" />
      </div>
    </Pantalla>
  );
}

function Tarea() {
  return (
    <Pantalla>
      <div className="w-60 space-y-2">
        <Burbuja>Mandame el guion antes del viernes</Burbuja>
        <div className="tour-aparecer flex items-center gap-2 rounded-xl border bg-card p-2 text-xs shadow-md">
          <ListTodo className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">Mandar el guion</span>
          <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] text-orange-700 dark:text-orange-300">vie</span>
        </div>
      </div>
    </Pantalla>
  );
}

function Prodi() {
  return (
    <Pantalla>
      <div className="w-60 space-y-2">
        <Burbuja mia>
          <b>@prodi</b> reunión con el equipo mañana a las 14
        </Burbuja>
        <div className="tour-aparecer flex items-start gap-1.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <Burbuja className="border-[#6F40FC]/30 bg-[#6F40FC]/[0.07]">Listo, agendé la reunión para mañana 14:00 📅</Burbuja>
        </div>
      </div>
    </Pantalla>
  );
}

function Videos() {
  const cols = [
    { t: "Idea", n: 3, c: "bg-sky-500" },
    { t: "Rodaje", n: 2, c: "bg-amber-500" },
    { t: "Edición", n: 4, c: "bg-primary" },
    { t: "Cliente", n: 1, c: "bg-orange-500" },
  ];
  return (
    <Pantalla>
      <div className="flex gap-1.5">
        {cols.map((col, i) => (
          <div key={col.t} className="w-14 space-y-1 rounded-lg bg-muted/60 p-1">
            <p className="flex items-center gap-1 text-[9px] font-semibold">
              <span className={cn("h-1.5 w-1.5 rounded-full", col.c)} />
              {col.t}
            </p>
            {Array.from({ length: Math.min(col.n, 3) }, (_, j) => (
              <div key={j} className="tour-subir h-4 rounded bg-card shadow-sm" style={{ animationDelay: `${(i * 3 + j) * 90}ms` }} />
            ))}
          </div>
        ))}
      </div>
    </Pantalla>
  );
}

function YaLoFilme() {
  return (
    <Pantalla>
      <div className="w-56 space-y-2">
        <div className="tour-latir mx-auto flex w-fit items-center gap-1.5 rounded-xl border-2 border-primary bg-card px-3 py-1.5 text-xs font-semibold">
          <Clapperboard className="h-4 w-4 text-primary" /> Ya lo filmé
        </div>
        <div className="tour-aparecer flex items-center gap-2 rounded-xl border bg-card p-2 text-xs">
          <Upload className="h-4 w-4 text-primary" /> Subí el material
          <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">a edición</span>
        </div>
      </div>
    </Pantalla>
  );
}

function Entrega() {
  return (
    <Pantalla>
      <div className="w-56 space-y-1.5">
        {[
          { t: "Entregar hoy", c: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
          { t: "Entregar el lun 12/10", c: "bg-muted text-muted-foreground" },
          { t: "Atrasado 1 día", c: "bg-destructive/15 text-destructive" },
        ].map((x, i) => (
          <div key={x.t} className="tour-subir flex items-center justify-between rounded-xl border bg-card p-2 text-xs" style={{ animationDelay: `${i * 200}ms` }}>
            <span>Video {i + 1}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]", x.c)}>
              <CalendarClock className="h-3 w-3" /> {x.t}
            </span>
          </div>
        ))}
      </div>
    </Pantalla>
  );
}

function Ganancias() {
  return (
    <Pantalla>
      <div className="w-56 rounded-2xl border bg-card p-3">
        <p className="text-[10px] text-muted-foreground">Llevás ganado en octubre</p>
        <p className="tour-latir text-2xl font-bold tabular-nums">$ 370.000</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="tour-llenar h-full rounded-full bg-primary" style={{ "--hasta": "78%" } as React.CSSProperties} />
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">+ $60.000 en camino</p>
      </div>
    </Pantalla>
  );
}

function Avisos() {
  return (
    <Pantalla>
      <div className="w-60 space-y-2">
        {["Video nuevo para editar", "Te mencionaron en DS"].map((t, i) => (
          <div key={t} className="tour-subir flex items-center gap-2 rounded-2xl border bg-card p-2 text-xs shadow-md" style={{ animationDelay: `${i * 350}ms` }}>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bell className="h-3.5 w-3.5" />
            </span>
            <span>
              <b className="block">Prodi</b>
              {t}
            </span>
          </div>
        ))}
      </div>
    </Pantalla>
  );
}

function PedirVideo() {
  const pasos = ["¿Qué?", "Idea", "Material", "Cuándo"];
  return (
    <Pantalla>
      <div className="w-60 space-y-3">
        <div className="tour-latir mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-md">
          + Pedir un video
        </div>
        <div className="flex items-center justify-between gap-1">
          {pasos.map((p, i) => (
            <div key={p} className="tour-subir flex flex-1 flex-col items-center gap-1" style={{ animationDelay: `${300 + i * 250}ms` }}>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{i + 1}</span>
              <span className="text-[9px] text-muted-foreground">{p}</span>
            </div>
          ))}
        </div>
      </div>
    </Pantalla>
  );
}

function Aprobar() {
  return (
    <Pantalla>
      <div className="w-52 overflow-hidden rounded-2xl border bg-card shadow-md">
        <div className="flex h-20 items-center justify-center bg-gradient-to-br from-primary/30 to-orange-400/30">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-primary">▶</span>
        </div>
        <div className="flex gap-1.5 p-2">
          <span className="flex-1 rounded-lg border py-1 text-center text-[10px] text-muted-foreground">Pedir cambios</span>
          <span className="tour-latir flex-1 rounded-lg bg-emerald-500 py-1 text-center text-[10px] font-semibold text-white">✓ Aprobar</span>
        </div>
      </div>
    </Pantalla>
  );
}

function SubirMaterial() {
  return (
    <Pantalla>
      <div className="w-56 space-y-2">
        {["obra-1.mp4", "obra-2.mp4"].map((n, i) => (
          <div key={n} className="tour-subir rounded-xl border bg-card p-2 text-xs" style={{ animationDelay: `${i * 300}ms` }}>
            <div className="flex items-center gap-2">
              <Upload className="h-3.5 w-3.5 text-primary" /> {n}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="tour-llenar h-full rounded-full bg-primary" style={{ "--hasta": "100%" } as React.CSSProperties} />
            </div>
          </div>
        ))}
      </div>
    </Pantalla>
  );
}

function Boleta() {
  return (
    <Pantalla>
      <div className="tour-subir w-48 rounded-2xl border bg-card p-3 shadow-md">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Receipt className="h-4 w-4 text-primary" /> Boleta de octubre
        </div>
        <div className="mt-2 space-y-1">
          <div className="h-1.5 w-full rounded bg-muted" />
          <div className="h-1.5 w-2/3 rounded bg-muted" />
        </div>
        <div className="mt-2 flex items-center justify-between rounded-lg bg-primary px-2 py-1 text-[11px] text-primary-foreground">
          <span>Total</span>
          <b>$ 459.800</b>
        </div>
      </div>
    </Pantalla>
  );
}

function Resultados() {
  const barras = [35, 55, 45, 80, 65, 95];
  return (
    <Pantalla>
      <div className="flex h-28 items-end gap-2">
        {barras.map((h, i) => (
          <div key={i} className="flex h-full w-5 flex-col justify-end overflow-hidden rounded-t-md bg-muted">
            <div className="tour-subir w-full rounded-t-md bg-primary" style={{ height: `${h}%`, animationDelay: `${i * 120}ms` }} />
          </div>
        ))}
      </div>
    </Pantalla>
  );
}

function Cupo() {
  return (
    <Pantalla>
      <div className="w-56 space-y-2 text-center">
        <p className="text-xs font-semibold">Te queda 1 video de octubre</p>
        <div className="flex justify-center gap-1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              className={cn("tour-subir flex h-6 w-6 items-center justify-center rounded-md border", i < 7 ? "border-primary/30 bg-primary/15 text-primary" : "border-dashed border-primary/50 text-primary/60")}
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <Clapperboard className="h-3 w-3" />
            </span>
          ))}
        </div>
      </div>
    </Pantalla>
  );
}

function Icono({ icon: Icon, texto }: { icon: React.ElementType; texto: string }) {
  return (
    <Pantalla>
      <div className="flex flex-col items-center gap-2">
        <span className="tour-latir flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
          <Icon className="h-8 w-8" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">{texto}</span>
      </div>
    </Pantalla>
  );
}

/** Administrador de anuncios: la columna "ID del anuncio" y se copia. */
function MetaCopiar() {
  return (
    <Pantalla>
      <div className="relative w-64 space-y-2">
        <div className="overflow-hidden rounded-xl border bg-card text-[10px] shadow-sm">
        <div className="grid grid-cols-[1fr_auto] gap-2 border-b bg-muted/60 px-2 py-1 font-semibold text-muted-foreground">
          <span>Anuncio</span>
          <span>ID del anuncio</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2 px-2 py-1.5 text-muted-foreground">
          <span className="truncate">Reel promo marzo</span>
          <span className="tabular-nums">1202…4410</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 bg-primary/[0.07] px-2 py-1.5">
          <span className="truncate font-medium">Fío y Ema pin pong</span>
          <span className="tour-latir rounded bg-primary px-1.5 py-0.5 font-mono tabular-nums text-primary-foreground">120212345678</span>
        </div>
        </div>
        <p className="text-center">
          <span className="tour-aparecer inline-block rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-semibold text-white">Copiado ✓</span>
        </p>
        <Dedo className="right-6 top-14" />
      </div>
    </Pantalla>
  );
}

/** En el video: se pega el ID en "ID del anuncio en Meta". */
function MetaPegar() {
  return (
    <Pantalla>
      <div className="relative w-60 space-y-1.5 rounded-xl border bg-card p-3 shadow-sm">
        <p className="text-[11px] font-semibold">ID del anuncio en Meta</p>
        <div className="rounded-lg border bg-background px-2 py-1.5 font-mono text-xs">
          <span className="tour-escribir inline-block align-bottom" style={{ "--ancho": "12ch" } as React.CSSProperties}>
            120212345678
          </span>
        </div>
        <div className="flex justify-end">
          <span className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground">Guardar</span>
        </div>
        <Dedo className="bottom-1 right-3" />
      </div>
    </Pantalla>
  );
}

/** Los números de Meta llegan solos al video. */
function MetaDatos() {
  const datos = [
    ["Alcance", "12.480"],
    ["Reproducciones", "8.902"],
    ["Mensajes", "37"],
    ["Inversión", "$ 45.000"],
  ];
  return (
    <Pantalla>
      <div className="w-64 space-y-2">
        <div className="grid grid-cols-2 gap-1.5">
          {datos.map(([k, v], i) => (
            <div key={k} className="tour-subir rounded-lg border bg-card px-2 py-1.5" style={{ animationDelay: `${i * 160}ms` }}>
              <p className="text-[9px] text-muted-foreground">{k}</p>
              <p className="text-xs font-bold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <RefreshCw className="tour-latir h-3 w-3 text-primary" /> Se actualiza solo todos los días a las 8
        </p>
      </div>
    </Pantalla>
  );
}

/** Corrección del cliente → "Hablarlo con el cliente" → la tarjeta en el chat. */
function HablarCliente() {
  return (
    <Pantalla>
      <div className="relative flex w-72 items-center gap-2">
        <div className="w-32 shrink-0 rounded-xl border border-orange-500/40 bg-orange-500/[0.08] p-2 text-[9px]">
          <p className="font-semibold text-orange-600 dark:text-orange-300">Cambios pedidos</p>
          <p className="mt-0.5 text-muted-foreground">-Rever título…</p>
          <span className="tour-latir mt-1.5 flex items-center justify-center gap-1 rounded-md border bg-background px-1 py-1 font-semibold">
            <MessageCircle className="h-2.5 w-2.5" /> Hablarlo
          </span>
        </div>
        <span className="text-primary">→</span>
        <div className="tour-aparecer flex-1 space-y-1 rounded-xl bg-primary p-1.5 text-primary-foreground">
          <div className="rounded-lg bg-white/15 px-1.5 py-1 text-[9px]">
            <p className="font-semibold">🎬 Fío y Ema pin pong</p>
            <p className="opacity-80">-Rever título…</p>
          </div>
          <p className="px-0.5 text-[9px]">¿Te gusta así?</p>
        </div>
        <Dedo className="bottom-3 left-12" />
      </div>
    </Pantalla>
  );
}

/** Lupa → se escribe la palabra → el mensaje encontrado se resalta. */
function ChatBuscar() {
  return (
    <Pantalla>
      <div className="w-60 space-y-2">
        <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs">
          <Search className="h-3.5 w-3.5 text-primary" />
          <span className="tour-escribir inline-block align-bottom" style={{ "--ancho": "7ch" } as React.CSSProperties}>
            guion
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground">1 de 3</span>
        </div>
        <Burbuja>Hola! ¿qué tal?</Burbuja>
        <Burbuja className="tour-aparecer ring-2 ring-amber-400">
          Te mandé el <mark className="rounded bg-amber-300/70 px-0.5 text-foreground">guion</mark> del jueves
        </Burbuja>
      </div>
    </Pantalla>
  );
}

/** El mensaje fijado aparece arriba del chat. */
function ChatFijar() {
  return (
    <Pantalla className="items-start pt-3">
      <div className="w-64 space-y-2">
        <div className="tour-aparecer flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.08] px-2.5 py-1.5 text-[11px]">
          <Pin className="h-3.5 w-3.5 shrink-0 rotate-45 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            <b>Fijado:</b> Rodaje el jueves 10 hs en el local
          </span>
        </div>
        <Burbuja>Rodaje el jueves 10 hs en el local</Burbuja>
        <Burbuja mia>Perfecto 👌</Burbuja>
        <Dedo className="left-24 top-12" />
      </div>
    </Pantalla>
  );
}

/** Encuesta con opciones de colores que se van llenando. */
function ChatEncuesta() {
  const ops = [
    { t: "La 1", p: "70%", c: "bg-violet-500" },
    { t: "La 2", p: "20%", c: "bg-sky-500" },
    { t: "La 3", p: "10%", c: "bg-emerald-500" },
  ];
  return (
    <Pantalla>
      <div className="w-60 overflow-hidden rounded-2xl border bg-card shadow-md">
        <div className="flex items-center gap-1.5 bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white">
          <BarChart3 className="h-3.5 w-3.5" /> ¿Qué portada va?
        </div>
        <div className="space-y-1.5 p-2.5">
          {ops.map((o, i) => (
            <div key={o.t} className="text-[10px]">
              <div className="mb-0.5 flex items-center gap-1.5">
                <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white", o.c)}>{String.fromCharCode(65 + i)}</span>
                {o.t}
                <span className="ml-auto text-muted-foreground">{o.p}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn("tour-llenar h-full rounded-full", o.c)} style={{ "--hasta": o.p } as React.CSSProperties} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Pantalla>
  );
}

/** El mensaje programado: la tarjeta verde con editar y cancelar. */
function ChatProgramar() {
  return (
    <Pantalla className="items-end pb-4">
      <div className="relative w-64 space-y-2">
        <div className="tour-aparecer flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.1] px-2.5 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-white">
            <CalendarClock className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] font-semibold text-emerald-700 dark:text-emerald-400">Programado · sale Mañana 08:00</span>
            <span className="block truncate text-[11px]">Buen día! Hoy filmamos a las 10</span>
          </span>
          <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          <span className="tour-latir flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-md">
            <CalendarClock className="h-4 w-4" />
          </span>
          <span className="flex-1 rounded-full border bg-background px-3 py-1.5 text-[11px] text-muted-foreground">Mensaje</span>
        </div>
      </div>
    </Pantalla>
  );
}

/** Audio con onda y el botón de velocidad. */
function ChatAudio() {
  const barras = [30, 55, 80, 45, 70, 95, 60, 40, 75, 50, 85, 35, 65, 45, 25, 55, 70, 40];
  return (
    <Pantalla>
      <div className="flex w-64 items-center gap-2 rounded-2xl rounded-br-md bg-primary px-2.5 py-2 text-primary-foreground shadow-md">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-primary">
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        </span>
        <div className="flex h-8 flex-1 items-center gap-[2px]">
          {barras.map((h, i) => (
            <span key={i} className={cn("w-[3px] rounded-full", i < 7 ? "bg-white" : "bg-white/45")} style={{ height: `${h}%` }} />
          ))}
        </div>
        <span className="tour-latir rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">1,5x</span>
      </div>
    </Pantalla>
  );
}

/** Reenviar a otro chat + la galería de lo compartido. */
function ChatReenviar() {
  return (
    <Pantalla>
      <div className="flex w-72 items-center gap-2">
        <div className="w-32 space-y-1.5">
          <Burbuja className="max-w-full">📎 guion-jueves.pdf</Burbuja>
          <div className="tour-aparecer flex items-center gap-1 rounded-xl border bg-popover px-2 py-1 text-[10px] shadow-md">
            <Forward className="h-3 w-3 text-primary" /> Reenviar a <b>Equipo</b>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-1">
          {["from-pink-400 to-rose-500", "from-sky-400 to-blue-600", "from-amber-300 to-orange-500", "from-emerald-400 to-teal-600", "from-violet-400 to-fuchsia-500", "from-slate-300 to-slate-500"].map((c, i) => (
            <span key={c} className={cn("tour-subir aspect-square rounded-md bg-gradient-to-br", c)} style={{ animationDelay: `${i * 120}ms` }} />
          ))}
          <span className="col-span-3 flex items-center justify-center gap-1 text-[9px] text-muted-foreground">
            <Images className="h-3 w-3" /> Galería del chat
          </span>
        </div>
      </div>
    </Pantalla>
  );
}

/** Llamada: la pantalla compartida en una ventanita flotante. */
function ChatPantalla() {
  return (
    <Pantalla>
      <div className="relative h-32 w-64 rounded-xl border bg-card p-2">
        <div className="space-y-1">
          <div className="h-2 w-2/3 rounded bg-muted" />
          <div className="h-2 w-1/2 rounded bg-muted" />
          <div className="h-2 w-3/4 rounded bg-muted" />
        </div>
        <div className="tour-deslizar absolute bottom-2 left-2 w-28 overflow-hidden rounded-lg border-2 border-emerald-500 bg-background shadow-xl">
          <div className="flex items-center gap-1 bg-emerald-500 px-1.5 py-0.5 text-[8px] font-semibold text-white">
            <MonitorUp className="h-2.5 w-2.5" /> Pantalla de Lucía
          </div>
          <div className="flex h-12 items-center justify-center bg-gradient-to-br from-primary/25 to-sky-400/25">
            <LayoutGrid className="h-5 w-5 text-primary" />
          </div>
        </div>
      </div>
    </Pantalla>
  );
}

/** Diseño → Revisión interna → Cliente. */
function RevisionInterna() {
  const pasos = [
    { t: "Diseño", c: "bg-sky-500" },
    { t: "Revisión", c: "bg-amber-500" },
    { t: "Cliente", c: "bg-emerald-500" },
  ];
  return (
    <Pantalla>
      <div className="w-64 space-y-3">
        <div className="flex items-center justify-between">
          {pasos.map((p, i) => (
            <div key={p.t} className="flex items-center">
              <div className="tour-subir flex flex-col items-center gap-1" style={{ animationDelay: `${i * 300}ms` }}>
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md", p.c, i === 1 && "tour-latir")}>
                  {i === 0 ? <Pencil className="h-4 w-4" /> : i === 1 ? <Search className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                </span>
                <span className="text-[10px] font-medium">{p.t}</span>
              </div>
              {i < 2 && <span className="mx-2 mb-4 text-muted-foreground">→</span>}
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          <span className="flex-1 rounded-lg border py-1 text-center text-[10px] text-muted-foreground">Pedir cambios</span>
          <span className="flex-1 rounded-lg bg-emerald-500 py-1 text-center text-[10px] font-semibold text-white">✓ Aprobar</span>
        </div>
      </div>
    </Pantalla>
  );
}

/** "Deshacer aprobación" y vuelve a revisión. */
function Deshacer() {
  return (
    <Pantalla>
      <div className="relative w-56 space-y-2 rounded-2xl border bg-card p-3 shadow-md">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Reel promo</span>
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">Aprobado</span>
        </div>
        <span className="tour-latir flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/10 py-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <Undo2 className="h-3.5 w-3.5" /> Deshacer aprobación
        </span>
        <p className="tour-aparecer text-center text-[10px] text-muted-foreground">Vuelve a revisión · el cliente ya no lo ve</p>
        <Dedo className="bottom-7 right-8" />
      </div>
    </Pantalla>
  );
}

/** Filtros del tablero: empresa y urgencia. */
function Filtros() {
  return (
    <Pantalla>
      <div className="w-64 space-y-2">
        <div className="flex gap-1.5">
          <span className="tour-latir flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground">
            <Building2 className="h-3 w-3" /> Pizzería Don Tano
          </span>
          <span className="flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[10px]">
            <CalendarClock className="h-3 w-3" /> Más urgente
          </span>
        </div>
        {["Entregar hoy", "Mañana", "Lun 19/10"].map((t, i) => (
          <div key={t} className="tour-subir flex items-center justify-between rounded-xl border bg-card px-2.5 py-1.5 text-[11px]" style={{ animationDelay: `${i * 200}ms` }}>
            <span>Video {i + 1} · Don Tano</span>
            <span className={cn("rounded-full px-1.5 py-0.5 text-[9px]", i === 0 ? "bg-orange-500/15 text-orange-700 dark:text-orange-300" : "bg-muted text-muted-foreground")}>{t}</span>
          </div>
        ))}
      </div>
    </Pantalla>
  );
}

/** Tarjeta atrasada: roja y titilando. */
function Atrasado() {
  return (
    <Pantalla>
      <div className="w-56 space-y-2">
        <div className="rounded-xl border bg-card px-2.5 py-2 text-[11px]">Video al día</div>
        <div className="animate-titilar rounded-xl border-2 border-destructive bg-destructive/10 px-2.5 py-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Reel de la semana</span>
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[9px] font-bold text-white">Atrasado 2 d</span>
          </div>
        </div>
      </div>
    </Pantalla>
  );
}

/** Cronómetro del rodaje. */
function Cronometro() {
  return (
    <Pantalla>
      <div className="w-56 space-y-2 rounded-2xl border bg-card p-3 text-center shadow-md">
        <p className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-red-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Filmando
        </p>
        <p className="font-mono text-2xl font-bold tabular-nums">
          <Timer className="mr-1 inline h-5 w-5 text-primary" />
          01:24:07
        </p>
        <span className="tour-latir inline-block rounded-lg bg-red-500 px-3 py-1 text-[11px] font-semibold text-white">Terminar</span>
      </div>
    </Pantalla>
  );
}

/** El guion desde el rodaje → al chat del cliente. */
function GuionCliente() {
  return (
    <Pantalla>
      <div className="relative flex w-72 items-center gap-2">
        <div className="w-32 shrink-0 space-y-1 rounded-xl border bg-card p-2 text-[9px]">
          <p className="flex items-center gap-1 font-semibold">
            <FileText className="h-3 w-3 text-primary" /> Guion
          </p>
          <div className="h-1.5 w-full rounded bg-muted" />
          <div className="h-1.5 w-3/4 rounded bg-muted" />
          <span className="tour-latir mt-1 flex items-center justify-center gap-1 rounded-md bg-primary px-1 py-1 font-semibold text-primary-foreground">
            <Send className="h-2.5 w-2.5" /> Mandar al cliente
          </span>
        </div>
        <span className="text-primary">→</span>
        <div className="tour-aparecer flex-1 rounded-xl bg-primary p-1.5 text-primary-foreground">
          <div className="rounded-lg bg-white/15 px-1.5 py-1 text-[9px]">
            <p className="font-semibold">📝 Guion: Promo jueves</p>
            <p className="opacity-80">Toma 1: frente del local…</p>
          </div>
        </div>
        <Dedo className="bottom-3 left-14" />
      </div>
    </Pantalla>
  );
}

/** Mapita con Reconquista, la localidad elegida y el viático. */
function Viaticos() {
  return (
    <Pantalla>
      <div className="relative h-32 w-64 overflow-hidden rounded-xl border bg-gradient-to-br from-emerald-500/10 to-sky-500/10">
        <span className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-primary/40" />
        <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-[8px] font-semibold">
          <span className="h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-primary/20" />
          Reconquista
        </span>
        <span className="tour-aparecer absolute left-[62%] top-[14%] flex flex-col items-center text-[8px] font-semibold">
          <MapPin className="h-5 w-5 fill-red-500 text-white" />
          Guadalupe Norte
        </span>
        <span className="tour-aparecer absolute bottom-1.5 right-1.5 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow">Viático $ 24.500</span>
      </div>
    </Pantalla>
  );
}

/** Varios videos en una filmación, con descuento desde el segundo. */
function Jornada() {
  return (
    <Pantalla>
      <div className="w-60 space-y-1.5">
        {["Video 1", "Video 2", "Video 3"].map((t, i) => (
          <div key={t} className="tour-subir flex items-center gap-2 rounded-xl border bg-card px-2.5 py-1.5 text-[11px]" style={{ animationDelay: `${i * 250}ms` }}>
            <Clapperboard className="h-3.5 w-3.5 text-primary" />
            {t}
            {i > 0 && <span className="ml-auto rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">−15%</span>}
          </div>
        ))}
        <p className="text-center text-[10px] text-muted-foreground">Un solo viaje · un solo viático</p>
      </div>
    </Pantalla>
  );
}

/** La ilustración animada de cada diapositiva. */
export function Ilustracion({ anim }: { anim: AnimRecorrido }) {
  switch (anim) {
    case "deslizar":
      return <Deslizar />;
    case "mencionar":
      return <Mencionar />;
    case "reaccionar":
      return <Reaccionar />;
    case "tarea":
      return <Tarea />;
    case "prodi":
      return <Prodi />;
    case "videos":
      return <Videos />;
    case "ya-lo-filme":
      return <YaLoFilme />;
    case "entrega":
      return <Entrega />;
    case "ganancias":
      return <Ganancias />;
    case "avisos":
      return <Avisos />;
    case "guion":
      return <Icono icon={Pencil} texto="Escribilo vos o con IA" />;
    case "cobros":
      return <Icono icon={Receipt} texto="Boletas y cobros" />;
    case "piezas":
      return <Icono icon={Images} texto="Piezas gráficas" />;
    case "pedir-video":
      return <PedirVideo />;
    case "aprobar":
      return <Aprobar />;
    case "subir-material":
      return <SubirMaterial />;
    case "boleta":
      return <Boleta />;
    case "resultados":
      return <Resultados />;
    case "cupo":
      return <Cupo />;
    case "meta-copiar":
      return <MetaCopiar />;
    case "meta-pegar":
      return <MetaPegar />;
    case "meta-datos":
      return <MetaDatos />;
    case "hablar-cliente":
      return <HablarCliente />;
    case "chat-buscar":
      return <ChatBuscar />;
    case "chat-fijar":
      return <ChatFijar />;
    case "chat-encuesta":
      return <ChatEncuesta />;
    case "chat-programar":
      return <ChatProgramar />;
    case "chat-audio":
      return <ChatAudio />;
    case "chat-reenviar":
      return <ChatReenviar />;
    case "chat-pantalla":
      return <ChatPantalla />;
    case "revision-interna":
      return <RevisionInterna />;
    case "deshacer":
      return <Deshacer />;
    case "filtros":
      return <Filtros />;
    case "atrasado":
      return <Atrasado />;
    case "cronometro":
      return <Cronometro />;
    case "guion-cliente":
      return <GuionCliente />;
    case "viaticos":
      return <Viaticos />;
    case "jornada":
      return <Jornada />;
    case "pagos":
      return <Icono icon={HandCoins} texto="Pagos al equipo" />;
    default:
      return <Icono icon={LayoutGrid} texto="Prodi" />;
  }
}
