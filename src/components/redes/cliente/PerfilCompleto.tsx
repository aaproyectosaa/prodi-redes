import { useEffect, useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { callApi } from "@/lib/redes/api";
import type { Project } from "@/integrations/firebase/types";
import type { ContextoComercial } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

export interface ItemPerfil {
  clave: string;
  titulo: string;
  /** Por qué conviene completarlo, en una línea. */
  para: string;
  listo: boolean;
}

// El contexto comercial lo da el servidor (el cliente no lee la memoria de la IA): se pide una vez por cliente
// y se guarda un rato, así el anillo del menú y la tarjeta no lo piden dos veces.
const cache = new Map<string, { at: number; c: ContextoComercial }>();
const oyentes = new Set<() => void>();
/** Después de guardar "Lo que vendés": que el porcentaje se actualice. */
export function refrescarPerfilCliente(proyectoId: string) {
  cache.delete(proyectoId);
  oyentes.forEach((f) => f());
}

function useComercialCliente(proyectoId: string | undefined): ContextoComercial | undefined {
  const [c, setC] = useState<ContextoComercial | undefined>(() => (proyectoId ? cache.get(proyectoId)?.c : undefined));
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    const f = () => setVuelta((n) => n + 1);
    oyentes.add(f);
    return () => {
      oyentes.delete(f);
    };
  }, []);
  useEffect(() => {
    if (!proyectoId) return;
    const hit = cache.get(proyectoId);
    if (hit && Date.now() - hit.at < 60_000) {
      setC(hit.c);
      return;
    }
    let vivo = true;
    callApi<{ comercial: ContextoComercial }>("/api/ia/comercial-ver", { proyecto_id: proyectoId })
      .then((r) => {
        cache.set(proyectoId, { at: Date.now(), c: r.comercial ?? {} });
        if (vivo) setC(r.comercial ?? {});
      })
      .catch(() => vivo && setC({}));
    return () => {
      vivo = false;
    };
  }, [proyectoId, vuelta]);
  return c;
}

/** Qué tiene completo el cliente de su perfil y el porcentaje. */
export function usePerfilCliente(cliente: Project | undefined): { pct: number; items: ItemPerfil[]; cargando: boolean } {
  const comercial = useComercialCliente(cliente?.id);
  const m = (cliente?.marca ?? {}) as Record<string, unknown>;
  const lleno = (v: unknown, min = 2) => typeof v === "string" && v.trim().length >= min;
  const items: ItemPerfil[] = [
    { clave: "logo", titulo: "Tu logo", para: "Para que las piezas y los videos lleven tu marca", listo: !!cliente?.marca_archivos?.logo },
    { clave: "colores", titulo: "Tus colores", para: "Así todo sale con tu identidad", listo: (Array.isArray(m.paleta) && m.paleta.length > 0) || lleno(m.colores) },
    { clave: "rubro", titulo: "A qué te dedicás", para: "Qué vendés y qué te hace distinto", listo: lleno(m.rubro) && lleno(m.descripcion, 10) },
    { clave: "publico", titulo: "A quién le vendés", para: "Para hablarle a la gente correcta", listo: lleno(m.publico) },
    { clave: "tono", titulo: "Cómo hablás", para: "Formal, cercano, con humor…", listo: lleno(m.tono) },
    { clave: "instagram", titulo: "Tu Instagram", para: "Para mirar lo que ya publicaste", listo: lleno((cliente?.redes as Record<string, unknown> | undefined)?.instagram) },
    { clave: "productos", titulo: "Tus productos o servicios", para: "Los videos muestran lo que vendés de verdad", listo: (comercial?.productos?.length ?? 0) > 0 },
    { clave: "negocio", titulo: "Tu negocio en pocas palabras", para: "Qué querés lograr con las redes", listo: lleno(comercial?.enfoque, 5) || lleno(comercial?.objetivo, 5) },
  ];
  const hechos = items.filter((i) => i.listo).length;
  return { pct: Math.round((hechos / items.length) * 100), items, cargando: comercial === undefined };
}

/** Anillo con el porcentaje (se llena con animación). */
export function AnilloPerfil({ pct, size = 44, grosor = 5, className, conTexto = true }: { pct: number; size?: number; grosor?: number; className?: string; conTexto?: boolean }) {
  const [lleno, setLleno] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setLleno(pct), 150);
    return () => window.clearTimeout(t);
  }, [pct]);
  const r = (size - grosor) / 2;
  const C = 2 * Math.PI * r;
  const completo = pct >= 100;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={`anillo-${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6F40FC" />
            <stop offset="100%" stopColor="#E040A0" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={grosor} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={grosor}
          strokeLinecap="round"
          stroke={completo ? "#10b981" : `url(#anillo-${size})`}
          strokeDasharray={C}
          strokeDashoffset={C - (C * lleno) / 100}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      {conTexto && (
        <span className={cn("absolute font-bold tabular-nums", size >= 60 ? "text-base" : "text-[10px]", completo && "text-emerald-600 dark:text-emerald-400")}>
          {completo ? <Check className={size >= 60 ? "h-6 w-6" : "h-3.5 w-3.5"} /> : `${pct}%`}
        </span>
      )}
    </span>
  );
}

/** Tarjeta "Completá tu perfil": el anillo grande y lo que falta. Al 100% no se muestra. */
export function TarjetaPerfil({ cliente, onCompletar }: { cliente: Project; onCompletar: () => void }) {
  const { pct, items, cargando } = usePerfilCliente(cliente);
  if (cargando || pct >= 100) return null;
  const faltan = items.filter((i) => !i.listo);
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5">
      <span className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-gradient-to-br from-[#6F40FC]/15 to-[#E040A0]/15 blur-2xl" />
      {/* En el celu: anillo y título arriba, lo que falta abajo a todo el ancho y el botón al final. */}
      <div className="relative space-y-4 sm:flex sm:items-center sm:gap-5 sm:space-y-0">
        <div className="flex items-center gap-4 sm:contents">
          <AnilloPerfil pct={pct} size={72} grosor={7} className="sm:hidden" />
          <AnilloPerfil pct={pct} size={84} grosor={8} className="hidden sm:inline-flex" />
          <div className="min-w-0 sm:hidden">
            <p className="flex items-center gap-1.5 text-lg font-semibold leading-tight">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" /> Completá tu perfil
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">Te {faltan.length === 1 ? "falta 1 cosa" : `faltan ${faltan.length} cosas`}.</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="hidden sm:block">
            <p className="flex items-center gap-1.5 text-lg font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Completá tu perfil
            </p>
            <p className="text-sm text-muted-foreground">
              Te {faltan.length === 1 ? "falta 1 cosa" : `faltan ${faltan.length} cosas`}. Con todo completo, tus videos y piezas salen mucho mejor.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:mt-3">
            {items.map((i) => (
              <span
                key={i.clave}
                title={i.para}
                className={cn(
                  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs",
                  i.listo ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 line-through decoration-emerald-600/40 dark:text-emerald-300" : "bg-background font-medium"
                )}
              >
                {i.listo ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                {i.titulo}
              </span>
            ))}
          </div>
        </div>
        <Button onClick={onCompletar} className="w-full shrink-0 bg-gradient-to-r from-[#6F40FC] to-[#E040A0] text-white hover:opacity-90 sm:w-auto">
          Completar <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** "Datos de tu marca": lo que el cliente cuenta de su negocio (lo usa la IA para videos, copys y piezas). */
export function DatosMarcaCliente({ cliente }: { cliente: Project }) {
  const m = (cliente.marca ?? {}) as Record<string, string | undefined>;
  const [rubro, setRubro] = useState(m.rubro ?? "");
  const [descripcion, setDescripcion] = useState(m.descripcion ?? "");
  const [publico, setPublico] = useState(m.publico ?? "");
  const [tono, setTono] = useState(m.tono ?? "");
  const [instagram, setInstagram] = useState(cliente.redes?.instagram ?? "");
  const [guardando, setGuardando] = useState(false);
  const cambio =
    rubro !== (m.rubro ?? "") || descripcion !== (m.descripcion ?? "") || publico !== (m.publico ?? "") || tono !== (m.tono ?? "") || instagram !== (cliente.redes?.instagram ?? "");
  const guardar = async () => {
    if (rubro.trim().length < 3 || descripcion.trim().length < 10) {
      toast.error("Contanos a qué te dedicás y qué te hace distinto (con un poco más de detalle).");
      return;
    }
    setGuardando(true);
    try {
      await callApi("/api/ia/marca-info", { proyecto_id: cliente.id, rubro, descripcion, publico, tono, instagram });
      toast.success("¡Guardado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div id="datos-marca" className="space-y-4 rounded-2xl border bg-card p-5">
      <div>
        <p className="font-semibold">Datos de tu marca</p>
        <p className="text-sm text-muted-foreground">Con esto armamos videos, textos y piezas que suenen a vos.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="A qué te dedicás" listo={rubro.trim().length >= 3}>
          <Input value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Ej: pizzería y delivery" />
        </Campo>
        <Campo label="Tu Instagram" listo={instagram.trim().length >= 2}>
          <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@tunegocio" />
        </Campo>
        <div className="sm:col-span-2">
          <Campo label="Qué te hace distinto" listo={descripcion.trim().length >= 10}>
            <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Ej: masa madre de 48 horas y delivery en 30 minutos" className="resize-none" />
          </Campo>
        </div>
        <Campo label="A quién le vendés" listo={publico.trim().length >= 2}>
          <Input value={publico} onChange={(e) => setPublico(e.target.value)} placeholder="Ej: familias de Reconquista, 25 a 50 años" />
        </Campo>
        <Campo label="Cómo hablás" listo={tono.trim().length >= 2}>
          <Input value={tono} onChange={(e) => setTono(e.target.value)} placeholder="Ej: cercano, con humor, con voseo" />
        </Campo>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void guardar()} disabled={!cambio || guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

/** Un campo con su tilde verde cuando está completo. */
function Campo({ label, listo, children }: { label: string; listo: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {listo ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
        {label}
      </span>
      {children}
    </label>
  );
}

/** En el menú (al lado del nombre del cliente): el anillo chico. Completo, no se muestra. */
export function AnilloPerfilMenu({ cliente }: { cliente: Project | undefined }) {
  const { pct, cargando } = usePerfilCliente(cliente);
  if (!cliente || cargando || pct >= 100) return null;
  return (
    <span title={`Tu perfil está al ${pct}%: completalo en «Mi negocio»`} className="animate-in fade-in zoom-in-50">
      <AnilloPerfil pct={pct} size={34} grosor={4} />
    </span>
  );
}
