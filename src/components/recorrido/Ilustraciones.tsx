import { Bell, CalendarClock, Clapperboard, HandCoins, Hand, Images, LayoutGrid, ListTodo, Pencil, Receipt, Reply, Sparkles, Upload } from "lucide-react";
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
    case "pagos":
      return <Icono icon={HandCoins} texto="Pagos al equipo" />;
    default:
      return <Icono icon={LayoutGrid} texto="Prodi" />;
  }
}
