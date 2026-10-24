import { useEffect, useState } from "react";
import { CheckCircle2, Clapperboard, HelpCircle, Lightbulb, MessageCircle, ShieldAlert, Sparkles, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { DemoContactos } from "@/components/redes/crm/DemoContactos";

// CRM en "Próximamente": el cliente ya lo ve en su menú pero todavía no lo puede usar (falta que Meta habilite la app
// para que los mensajes entren solos). En cada sección, una animación paso a paso con un tablero de ejemplo muestra
// lo que va a poder hacer. Los datos son inventados.

export type SeccionCrm = "contactos" | "vende" | "equipo";

/** Avanza solo de paso en paso (y vuelve a empezar). Se puede tocar un punto para ir a un paso. */
function usePasos(total: number, ms = 2800) {
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPaso((p) => (p + 1) % total), ms);
    return () => clearInterval(t);
  }, [total, ms, paso]);
  return [paso, setPaso] as const;
}

function Pasos({ textos, paso, onPaso }: { textos: string[]; paso: number; onPaso: (n: number) => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <p key={paso} className="min-h-[1.5rem] text-center text-sm font-semibold animate-in fade-in slide-in-from-bottom-1 duration-500 sm:text-base">
        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-xs font-bold text-white">{paso + 1}</span>
        {textos[paso]}
      </p>
      <div className="flex gap-1.5">
        {textos.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPaso(i)}
            aria-label={`Paso ${i + 1}`}
            className={cn("h-1.5 rounded-full transition-all duration-300", i === paso ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60")}
          />
        ))}
      </div>
    </div>
  );
}

/** Marco común: etiqueta "Próximamente", título corto y la animación. */
function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-3xl border bg-gradient-to-br from-primary/10 via-fuchsia-500/[0.06] to-transparent p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-3 py-1 text-xs font-bold text-white shadow-md shadow-primary/25">
            <Sparkles className="h-3.5 w-3.5" /> Próximamente
          </span>
          <h2 className="mt-2 text-lg font-bold sm:text-xl">{titulo}</h2>
        </div>
        <p className="max-w-xs text-xs text-muted-foreground">Lo activamos apenas Meta habilite la conexión con WhatsApp, Instagram y Facebook. Te avisamos.</p>
      </div>
      {children}
    </div>
  );
}

// --- Qué te vende: los videos que venden y lo que preguntan -------------------------------------------------------

const PASOS_VENDE = [
  "Cada venta queda atada al video que la trajo",
  "Ves qué video te vendió más (y cuánto te costó cada venta)",
  "La IA lee tus charlas y encuentra lo que más te preguntan",
  "Y te propone el video que lo responde: entra en tu plan del mes",
];
const VIDEOS = [
  { titulo: "Promo 2x1 de los jueves", monto: "$ 240.000", ancho: 100 },
  { titulo: "Cómo hacemos la masa madre", monto: "$ 96.500", ancho: 42 },
  { titulo: "Delivery hasta las 2 AM", monto: "$ 32.700", ancho: 16 },
];

function DemoVende() {
  const [paso, setPaso] = usePasos(PASOS_VENDE.length, 3200);
  return (
    <Marco titulo="Qué video te vende y qué te preguntan tus clientes">
      <div className="grid gap-3 md:grid-cols-2">
        <div className={cn("space-y-2 rounded-2xl border bg-card p-3 transition-opacity duration-500", paso >= 2 && "opacity-50")}>
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <Clapperboard className="h-3.5 w-3.5 text-primary" /> Los videos que te vendieron
          </p>
          {paso >= 1 && (
            <div className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary/15 to-transparent p-2 text-[11px] animate-in fade-in duration-500">
              <Trophy className="h-4 w-4 text-primary" /> «Promo 2x1» te vendió <b className="text-emerald-600 dark:text-emerald-400">$ 240.000</b>
            </div>
          )}
          {VIDEOS.map((v, i) => (
            <div key={v.titulo} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate font-medium">{v.titulo}</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{v.monto}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500 transition-all duration-1000 ease-out motion-reduce:transition-none"
                  style={{ width: paso >= 0 ? `${v.ancho}%` : "0%", transitionDelay: `${i * 200}ms` }}
                />
              </div>
            </div>
          ))}
          {paso >= 1 && <p className="text-[10px] text-muted-foreground animate-in fade-in duration-500">Cada venta te costó $ 2.100 de publicidad</p>}
        </div>

        <div className={cn("space-y-2 rounded-2xl border bg-card p-3 transition-opacity duration-500", paso < 2 && "opacity-50")}>
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <HelpCircle className="h-3.5 w-3.5 text-primary" /> Lo que más te preguntan
          </p>
          {paso >= 2 ? (
            <div className="space-y-1.5">
              {[
                { t: "¿Hacen delivery a mi barrio?", n: 4, icono: HelpCircle, clase: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
                { t: "Les parece caro para grupos", n: 3, icono: ShieldAlert, clase: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
              ].map((x, i) => (
                <div key={x.t} className="flex items-center justify-between gap-2 rounded-lg border bg-background p-2 animate-in fade-in slide-in-from-right-2 duration-500" style={{ animationDelay: `${i * 250}ms` }}>
                  <span className="truncate text-[11px] font-medium">{x.t}</span>
                  <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold", x.clase)}>
                    <x.icono className="h-2.5 w-2.5" /> {x.n} personas
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-[11px] text-muted-foreground">Leyendo tus charlas…</p>
          )}
          {paso >= 3 && (
            <div className="rounded-lg bg-gradient-to-br from-primary/[0.12] to-fuchsia-500/[0.08] p-2 animate-in fade-in zoom-in-95 duration-500">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Lightbulb className="h-3 w-3" /> Video que lo responde
              </p>
              <p className="text-xs font-semibold">Hasta tu puerta en 30 minutos</p>
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-2.5 w-2.5" /> En tu plan del mes
              </p>
            </div>
          )}
        </div>
      </div>
      <Pasos textos={PASOS_VENDE} paso={paso} onPaso={setPaso} />
    </Marco>
  );
}

// --- Equipo: el reparto entre vendedores --------------------------------------------------------------------------

const PASOS_EQUIPO = [
  "Sumás a quienes contestan los mensajes",
  "Cada contacto nuevo va al que tiene menos trabajo",
  "Ves cuánto vendió cada uno",
  "Y le mandás por WhatsApp a quién escribirle hoy",
];

function DemoEquipo() {
  const [paso, setPaso] = usePasos(PASOS_EQUIPO.length, 3000);
  const vendedores = [
    { nombre: "Caro Medina", ini: "CM", abiertos: paso >= 1 ? 3 : 2, ventas: 5, monto: "$ 132.700", pct: "40%" },
    { nombre: "Nico Sosa", ini: "NS", abiertos: 4, ventas: 3, monto: "$ 92.000", pct: "33%" },
  ];
  return (
    <Marco titulo="Tu equipo de ventas, ordenado">
      <div className="relative grid gap-3 sm:grid-cols-2">
        {vendedores.map((v, i) => (
          <div key={v.ini} className={cn("space-y-2 rounded-2xl border bg-card p-3 transition-all duration-500", paso === 1 && i === 0 && "ring-2 ring-primary/50", paso === 0 && "animate-in fade-in zoom-in-95 duration-500")}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-xs font-bold text-white">{v.ini}</span>
              <span>
                <span className="block text-sm font-semibold">{v.nombre}</span>
                <span className="block text-[11px] text-muted-foreground">{v.abiertos} contactos abiertos</span>
              </span>
            </div>
            <div className={cn("grid grid-cols-3 gap-1.5 text-center transition-opacity duration-500", paso < 2 && "opacity-40")}>
              {[
                [String(v.ventas), "ventas"],
                [v.monto, "vendió"],
                [v.pct, "compró"],
              ].map(([n, l]) => (
                <div key={l} className="rounded-lg bg-muted/50 p-1.5">
                  <p className="whitespace-nowrap text-xs font-bold">{n}</p>
                  <p className="text-[9px] text-muted-foreground">{l}</p>
                </div>
              ))}
            </div>
            {paso === 3 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 animate-in fade-in duration-500 dark:text-emerald-300">
                <MessageCircle className="h-3 w-3" /> «Hoy escribiles a: Marta, Julián…»
              </div>
            )}
          </div>
        ))}
        {paso === 1 && (
          <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-3 rounded-full border bg-background px-2.5 py-1 text-[11px] font-semibold shadow-lg animate-in fade-in slide-in-from-top-2 duration-500">
            Nuevo: <b>Marta</b> → Caro
          </div>
        )}
      </div>
      <Pasos textos={PASOS_EQUIPO} paso={paso} onPaso={setPaso} />
    </Marco>
  );
}

export function CrmProximamente({ seccion = "contactos", rubro }: { seccion?: SeccionCrm; rubro?: string | null }) {
  if (seccion === "vende") return <DemoVende />;
  if (seccion === "equipo") return <DemoEquipo />;
  return (
    <Marco titulo="Así vas a atender y venderle a cada cliente que te escribe">
      <DemoContactos rubro={rubro} />
    </Marco>
  );
}
