import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Check, ChevronDown, FileText, Flame, Loader2, Mail, MessageCircle, Pencil, Phone, Snowflake, StickyNote, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { collection, db, onSnapshot } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import { fechaHora, hace, hoyISO } from "@/lib/redes/format";
import { ESTADO_PRESUPUESTO, estadoVisible, usePresupuestos } from "@/lib/redes/presupuestos";
import { cn } from "@/lib/utils";

// CRM: seguimiento de cada lead. Próximo paso con fecha, alerta de frío, WhatsApp con mensajes armados,
// línea de tiempo (llamadas, mensajes, notas, presupuesto) y el presupuesto conectado.

export interface EventoLead {
  at: string;
  de?: string | null;
  a?: string;
  tipo?: string;
  texto?: string;
  por_nombre?: string;
}

/** Lo mínimo de un lead que usa el seguimiento (el resto lo tiene la página). */
export interface LeadSeguimiento {
  id: string;
  created_at: string;
  negocio: string;
  nombre: string;
  email?: string;
  telefono?: string;
  estado: string;
  manual?: boolean;
  historial?: EventoLead[];
  proximo_paso?: { texto: string; fecha: string | null; at: string } | null;
  ultimo_contacto_at?: string | null;
}

/** Etapas donde el lead está vivo (hay que moverlo). */
const VIVOS = ["calificado", "reunion_agendada", "propuesta"];
const NOMBRES_ESTADO: Record<string, string> = {
  no_califica: "No califica",
  calificado: "Nuevo",
  reunion_agendada: "Reunión",
  propuesta: "Propuesta",
  ganado: "Ganado",
  perdido: "Perdido",
};

const DIA = 86_400_000;
const sumarDias = (n: number) => hoyISO(Date.now() + n * DIA);
const fechaCorta = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });

/** Cuándo fue el último contacto real (no cuenta lo que hizo la web sola). */
export function ultimoContacto(l: LeadSeguimiento): string | null {
  if (l.ultimo_contacto_at) return l.ultimo_contacto_at;
  const delEquipo = (l.historial ?? []).filter((h) => h.por_nombre && h.por_nombre !== "Web");
  return delEquipo.length ? delEquipo[delEquipo.length - 1].at : null;
}

/**
 * ¿Se está enfriando? Un lead vivo sin contacto en 3 días, o uno de la web que nadie contactó en la primera hora
 * (los de la web se enfrían rápido: aplicaron y están esperando).
 */
export function frioDe(l: LeadSeguimiento): { texto: string; nivel: "frio" | "urgente" } | null {
  if (!VIVOS.includes(l.estado)) return null;
  const ultimo = ultimoContacto(l);
  const ahora = Date.now();
  if (!ultimo) {
    const horas = (ahora - new Date(l.created_at).getTime()) / 3_600_000;
    if (!l.manual && horas >= 1) return { texto: horas < 24 ? `Sin contactar hace ${Math.floor(horas)} h` : `Sin contactar hace ${Math.floor(horas / 24)} d`, nivel: "urgente" };
    if (l.manual && horas >= 72) return { texto: `Sin contactar hace ${Math.floor(horas / 24)} d`, nivel: "frio" };
    return null;
  }
  const dias = Math.floor((ahora - new Date(ultimo).getTime()) / DIA);
  return dias >= 3 ? { texto: `Frío · ${dias} días sin contacto`, nivel: dias >= 7 ? "urgente" : "frio" } : null;
}

/** El próximo paso, como etiqueta: vencido en rojo, hoy en ámbar. */
export function ProximoPasoChip({ lead }: { lead: LeadSeguimiento }) {
  const frio = frioDe(lead);
  const p = lead.proximo_paso;
  const hoy = hoyISO();
  if (!p && !frio) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {p && (
        <span
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            p.fecha && p.fecha < hoy
              ? "bg-red-500/15 text-red-700 dark:text-red-300"
              : p.fecha === hoy
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-primary/10 text-primary"
          )}
        >
          <CalendarClock className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {p.fecha ? (p.fecha < hoy ? "Atrasado · " : p.fecha === hoy ? "Hoy · " : `${fechaCorta(p.fecha)} · `) : ""}
            {p.texto}
          </span>
        </span>
      )}
      {frio && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            frio.nivel === "urgente" ? "bg-red-500 text-white" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
          )}
        >
          {frio.nivel === "urgente" ? <Flame className="h-3 w-3" /> : <Snowflake className="h-3 w-3" />} {frio.texto}
        </span>
      )}
    </span>
  );
}

/** Link de WhatsApp con el mensaje (número argentino: 0 → 54). */
const linkWhatsApp = (tel: string, texto: string) => `https://wa.me/${tel.replace(/\D/g, "").replace(/^0/, "54")}?text=${encodeURIComponent(texto)}`;

/** Mensajes armados según en qué etapa está. */
function mensajesPara(l: LeadSeguimiento, yo: string): { label: string; texto: string }[] {
  const nombre = l.nombre?.split(" ")[0] || "";
  const hola = `¡Hola${nombre ? ` ${nombre}` : ""}! Soy ${yo || "del equipo"} de Prodi.`;
  const lista = [
    {
      label: "Primer contacto",
      texto: `${hola} Vi que te interesa trabajar con nosotros para ${l.negocio}. ¿Te queda bien que hablemos 15 minutos esta semana y vemos cómo te podemos ayudar con videos y pauta?`,
    },
    {
      label: "Confirmar la reunión",
      texto: `${hola} Te escribo para confirmar nuestra reunión. ¿Seguimos en pie? Cualquier cosa avisame y la movemos.`,
    },
    {
      label: "Después de la reunión",
      texto: `¡Gracias por la charla${nombre ? `, ${nombre}` : ""}! Te armo la propuesta para ${l.negocio} con lo que hablamos y te la mando en estos días.`,
    },
    {
      label: "¿Viste la propuesta?",
      texto: `¡Hola${nombre ? ` ${nombre}` : ""}! ¿Pudiste ver la propuesta que te mandamos? Si querés la charlamos y la ajustamos a lo que necesitás.`,
    },
    {
      label: "Retomar contacto",
      texto: `¡Hola${nombre ? ` ${nombre}` : ""}! ¿Cómo va todo en ${l.negocio}? Quería saber si seguís con ganas de arrancar con videos y pauta. Tenemos lugar para empezar este mes.`,
    },
  ];
  // Primero el que corresponde a la etapa.
  const primero = l.estado === "calificado" ? 0 : l.estado === "reunion_agendada" ? 1 : l.estado === "propuesta" ? 3 : 4;
  return [lista[primero], ...lista.filter((_, i) => i !== primero)];
}

const ICONO_TIPO: Record<string, React.ElementType> = { llamada: Phone, whatsapp: MessageCircle, email: Mail, reunion: Users, nota: StickyNote, presupuesto: FileText, paso: CalendarClock };
/** Color del ícono de cada cosa en la línea de tiempo. */
const COLOR_TIPO: Record<string, string> = {
  whatsapp: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  llamada: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  reunion: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  email: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  presupuesto: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  paso: "bg-primary/15 text-primary",
  nota: "bg-muted text-muted-foreground",
};

/** Título chico de cada parte (igual que en la ficha). */
function Titulo({ children, accion }: { children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
      {accion}
    </div>
  );
}

const fechaLinda = (f: string | null) => {
  if (!f) return "Sin fecha";
  const hoy = hoyISO();
  if (f === hoy) return "Hoy";
  if (f < hoy) return "Atrasado";
  const d = new Date(`${f}T12:00:00`);
  const dias = Math.round((d.getTime() - new Date(`${hoy}T12:00:00`).getTime()) / 86400_000);
  if (dias === 1) return "Mañana";
  return d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
};

async function registrar(id: string, tipo: string, texto: string, cumplido = false) {
  await callApi("/api/web/actividad", { id, tipo, texto, cumplido });
}
export const registrarActividad = registrar;

/** WhatsApp desde los datos del lead: elegir un mensaje armado (queda anotado en la actividad). */
export function MensajesWhatsApp({ lead, onListo }: { lead: LeadSeguimiento; onListo: () => void }) {
  const { profile } = useUserProfileContext();
  const yo = profile?.nombre?.split(" ")[0] ?? "";
  const mandar = (texto: string, label: string) => {
    if (!lead.telefono) return;
    window.open(linkWhatsApp(lead.telefono, texto), "_blank", "noopener");
    void registrar(lead.id, "whatsapp", `Le escribiste por WhatsApp: ${label}`).catch(() => {});
    onListo();
  };
  return (
    <div className="space-y-1 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-1.5">
      <p className="px-2 pt-1 text-[11px] text-muted-foreground">Elegí el mensaje (lo podés cambiar en WhatsApp antes de mandarlo)</p>
      {mensajesPara(lead, yo).map((m) => (
        <button key={m.label} type="button" onClick={() => mandar(m.texto, m.label)} className="block w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-background">
          <span className="block text-xs font-semibold">{m.label}</span>
          <span className="line-clamp-2 block text-[11px] text-muted-foreground">{m.texto}</span>
        </button>
      ))}
      <button type="button" onClick={() => mandar("", "sin mensaje armado")} className="px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-300">
        Abrir el chat sin mensaje
      </button>
    </div>
  );
}

/**
 * Al marcar el próximo paso como hecho: cómo le fue. Queda anotado en la actividad, propone el paso siguiente
 * y, si corresponde, mueve la etapa (reunión agendada → Reunión; no va → Perdido).
 */
const RESULTADOS: { id: string; label: string; tipo: string; paso: string | null; dias: number | null; estado?: string; desde?: string[] }[] = [
  { id: "no_contesto", label: "No contestó", tipo: "llamada", paso: "Volver a intentar", dias: 2 },
  { id: "interesa", label: "Le interesa", tipo: "nota", paso: "Agendar la reunión", dias: 1 },
  { id: "reunion", label: "Reunión agendada", tipo: "reunion", paso: "Reunión", dias: 2, estado: "reunion_agendada", desde: ["calificado"] },
  { id: "presupuesto", label: "Pidió presupuesto", tipo: "nota", paso: "Mandarle el presupuesto", dias: 0 },
  { id: "pensando", label: "Lo está pensando", tipo: "nota", paso: "Preguntarle si lo pensó", dias: 3 },
  { id: "no_va", label: "No va", tipo: "nota", paso: null, dias: null, estado: "perdido" },
];

/** El "¿Cómo te fue?" que aparece al tocar «Lo hice». */
function ComoTeFue({ lead, onListo }: { lead: LeadSeguimiento; onListo: () => void }) {
  const [elegido, setElegido] = useState<(typeof RESULTADOS)[number] | null>(null);
  const [comentario, setComentario] = useState("");
  const [paso, setPaso] = useState("");
  const [fecha, setFecha] = useState<string | null>(sumarDias(1));
  const [busy, setBusy] = useState(false);
  const elegir = (r: (typeof RESULTADOS)[number]) => {
    setElegido(r);
    setPaso(r.paso ?? "");
    setFecha(r.dias == null ? null : sumarDias(r.dias));
  };
  const guardar = async () => {
    setBusy(true);
    try {
      const hecho = lead.proximo_paso?.texto ?? "";
      const texto = [elegido ? elegido.label : "Hecho", comentario.trim()].filter(Boolean).join(": ");
      await registrar(lead.id, elegido?.tipo ?? "nota", hecho ? `${texto} (${hecho})` : texto, true);
      if (elegido?.estado && elegido.estado !== lead.estado && (!elegido.desde || elegido.desde.includes(lead.estado)))
        await callApi("/api/web/estado", { id: lead.id, estado: elegido.estado });
      if (paso.trim().length >= 3) await callApi("/api/web/seguimiento", { id: lead.id, texto: paso.trim(), fecha });
      toast.success(paso.trim() ? "Anotado. Próximo paso listo" : "Anotado");
      onListo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.04] p-3">
      <p className="text-sm font-semibold">¿Cómo te fue?</p>
      <div className="flex flex-wrap gap-1.5">
        {RESULTADOS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => elegir(r)}
            className={cn(
              "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
              elegido?.id === r.id
                ? r.id === "no_va"
                  ? "border-red-500 bg-red-500 text-white"
                  : "border-primary bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:border-primary/40"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      <Input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Algo para acordarte (opcional)" maxLength={300} className="h-9 bg-background" />
      {elegido && elegido.paso !== null && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lo que sigue</p>
          <Input value={paso} onChange={(e) => setPaso(e.target.value)} maxLength={200} className="h-9 bg-background" />
          <div className="flex flex-wrap items-center gap-1">
            {[
              { label: "Hoy", f: sumarDias(0) },
              { label: "Mañana", f: sumarDias(1) },
              { label: "En 3 días", f: sumarDias(3) },
              { label: "En una semana", f: sumarDias(7) },
            ].map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setFecha(r.f)}
                className={cn(
                  "h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors",
                  fecha === r.f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {r.label}
              </button>
            ))}
            <input type="date" value={fecha ?? ""} onChange={(e) => setFecha(e.target.value || null)} className="h-7 rounded-full border bg-background px-2 text-[11px]" aria-label="Otra fecha" />
          </div>
        </div>
      )}
      {elegido?.id === "no_va" && <p className="text-xs text-muted-foreground">Pasa a Perdidos. Si querés, contá por qué arriba: sirve para ver qué falla.</p>}
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" className="h-8 rounded-full text-xs" onClick={onListo}>
          Cancelar
        </Button>
        <Button size="sm" className="h-8 rounded-full px-4 text-xs" onClick={() => void guardar()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

/** El panel de seguimiento en la ficha del lead. */
export function SeguimientoLead({ lead }: { lead: LeadSeguimiento }) {
  const navigate = useNavigate();
  const { profile } = useUserProfileContext();
  const yo = profile?.nombre?.split(" ")[0] ?? "";
  const [paso, setPaso] = useState(lead.proximo_paso?.texto ?? "");
  const [fecha, setFecha] = useState<string | null>(lead.proximo_paso?.fecha ?? sumarDias(1));
  const [guardandoPaso, setGuardandoPaso] = useState(false);
  const [tipoRegistro, setTipoRegistro] = useState<"llamada" | "nota" | "reunion" | "email">("nota");
  const [textoRegistro, setTextoRegistro] = useState("");
  const [busy, setBusy] = useState(false);
  const [editandoPaso, setEditandoPaso] = useState(false);
  const [verTodo, setVerTodo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  useEffect(() => setCerrando(false), [lead.id]);
  const presupuestos = usePresupuestos(true);
  const suyos = (presupuestos ?? []).filter((p) => (p as { lead_id?: string }).lead_id === lead.id);

  useEffect(() => {
    setPaso(lead.proximo_paso?.texto ?? "");
    setFecha(lead.proximo_paso?.fecha ?? sumarDias(1));
  }, [lead.id, lead.proximo_paso?.texto, lead.proximo_paso?.fecha]);

  const guardarPaso = async (borrar = false) => {
    setGuardandoPaso(true);
    try {
      await callApi("/api/web/seguimiento", { id: lead.id, texto: borrar ? "" : paso, fecha: borrar ? null : fecha });
      toast.success(borrar ? "Próximo paso sacado" : "Próximo paso guardado");
      if (borrar) setPaso("");
      setEditandoPaso(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardandoPaso(false);
    }
  };

  const guardarRegistro = async () => {
    if (!textoRegistro.trim()) return;
    setBusy(true);
    try {
      await registrar(lead.id, tipoRegistro, textoRegistro.trim());
      toast.success("Anotado en la actividad");
      setTipoRegistro("nota");
      setTextoRegistro("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo anotar");
    } finally {
      setBusy(false);
    }
  };

  const rapidas: { label: string; f: string }[] = [
    { label: "Hoy", f: sumarDias(0) },
    { label: "Mañana", f: sumarDias(1) },
    { label: "En 3 días", f: sumarDias(3) },
    { label: "En una semana", f: sumarDias(7) },
  ];
  const historial = useMemo(() => [...(lead.historial ?? [])].reverse(), [lead.historial]);
  const frio = frioDe(lead);

  const pasoVencido = lead.proximo_paso?.fecha && lead.proximo_paso.fecha < hoyISO();
  const pasoHoy = lead.proximo_paso?.fecha === hoyISO();
  const mostrarFormPaso = !lead.proximo_paso || editandoPaso;
  const registros = [
    { t: "nota" as const, label: "Nota" },
    { t: "llamada" as const, label: "Llamada" },
    { t: "reunion" as const, label: "Reunión" },
    { t: "email" as const, label: "Mail" },
  ];
  const visibles = verTodo ? historial : historial.slice(0, 5);

  return (
    <div className="space-y-4">
      {frio && (
        <p
          className={cn(
            "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium",
            frio.nivel === "urgente" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-sky-500/10 text-sky-700 dark:text-sky-300"
          )}
        >
          {frio.nivel === "urgente" ? <Flame className="h-4 w-4 shrink-0" /> : <Snowflake className="h-4 w-4 shrink-0" />}
          {frio.texto}. Escribile o llamalo hoy.
        </p>
      )}

      {/* Próximo paso */}
      <section className="space-y-2">
        <Titulo>Próximo paso</Titulo>
        {cerrando && lead.proximo_paso ? (
          <ComoTeFue lead={lead} onListo={() => setCerrando(false)} />
        ) : !mostrarFormPaso && lead.proximo_paso ? (
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border p-3",
              pasoVencido ? "border-red-500/40 bg-red-500/5" : pasoHoy ? "border-amber-500/40 bg-amber-500/5" : "bg-card"
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-[10px] font-bold leading-tight",
                pasoVencido ? "bg-red-500 text-white" : pasoHoy ? "bg-amber-500 text-white" : "bg-primary/10 text-primary"
              )}
            >
              <CalendarClock className="mb-0.5 h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{lead.proximo_paso.texto}</p>
              <p className={cn("text-[11px]", pasoVencido ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground")}>{fechaLinda(lead.proximo_paso.fecha)}</p>
            </div>
            <Button
              size="sm"
              className="h-8 rounded-full bg-emerald-500 px-3 text-xs text-white hover:bg-emerald-600"
              onClick={() => setCerrando(true)}
              title="Ya lo hice: contá cómo te fue"
            >
              <Check className="mr-1 h-3.5 w-3.5" /> Lo hice
            </Button>
            <button type="button" onClick={() => setEditandoPaso(true)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Cambiar" aria-label="Cambiar">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="space-y-2 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] to-sky-500/[0.04] p-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
                <CalendarClock className="h-4 w-4" />
              </span>
              <Input
                value={paso}
              onChange={(e) => setPaso(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && paso.trim().length >= 3 && void guardarPaso()}
                placeholder="¿Qué sigue? Ej.: llamarlo para agendar la reunión"
                maxLength={200}
                className="h-9 border-0 bg-background/80 focus-visible:ring-1"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {rapidas.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => setFecha(r.f)}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors",
                    fecha === r.f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground"
                  )}
                >
                  {r.label}
                </button>
              ))}
              <input type="date" value={fecha ?? ""} onChange={(e) => setFecha(e.target.value || null)} className="h-7 rounded-full border bg-background px-2 text-[11px]" aria-label="Otra fecha" />
              <div className="ml-auto flex items-center gap-1">
                {lead.proximo_paso && (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void guardarPaso(true)} disabled={guardandoPaso} title="Sacar el próximo paso">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setEditandoPaso(false)}>
                      Cancelar
                    </Button>
                  </>
                )}
                <Button size="sm" className="h-7 rounded-full px-3 text-[11px]" onClick={() => void guardarPaso()} disabled={guardandoPaso || paso.trim().length < 3}>
                  {guardandoPaso ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Anotar lo que pasó (lo que se hizo por fuera: una llamada desde el celular, la reunión, un mail, una nota) */}
      <section className="space-y-2">
        <Titulo>Anotar algo que pasó</Titulo>
        <div className="space-y-2 rounded-2xl border bg-card p-2">
          <Textarea
            rows={2}
            value={textoRegistro}
            onChange={(e) => setTextoRegistro(e.target.value)}
            placeholder={tipoRegistro === "llamada" ? "¿Qué hablaron?" : tipoRegistro === "reunion" ? "¿Cómo fue la reunión?" : tipoRegistro === "email" ? "¿Qué le mandaste?" : "Escribí lo que pasó"}
            className="min-h-[52px] resize-none border-0 bg-muted/40 text-sm focus-visible:ring-1"
          />
          <div className="flex flex-wrap items-center gap-1">
            {registros.map(({ t: tipo, label }) => {
              const Icono = ICONO_TIPO[tipo];
              const activo = tipoRegistro === tipo;
              return (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setTipoRegistro(tipo)}
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors",
                    activo ? COLOR_TIPO[tipo] : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icono className="h-3.5 w-3.5" /> {label}
                </button>
              );
            })}
            <Button size="sm" className="ml-auto h-7 rounded-full px-3 text-[11px]" onClick={() => void guardarRegistro()} disabled={busy || !textoRegistro.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Anotar"}
            </Button>
          </div>
        </div>
      </section>

      {/* Presupuesto conectado */}
      <section className="space-y-2">
        <Titulo
          accion={
            <button type="button" onClick={() => navigate(`/presupuestos?lead=${lead.id}`)} className="text-[11px] font-semibold text-primary hover:underline">
              {suyos.length ? "+ Armar otro" : "+ Armar presupuesto"}
            </button>
          }
        >
          Presupuesto
        </Titulo>
        {suyos.length === 0 ? (
          <button
            type="button"
            onClick={() => navigate(`/presupuestos?lead=${lead.id}`)}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400">
              <FileText className="h-4 w-4" />
            </span>
            <span className="text-xs text-muted-foreground">Armalo desde acá: vas a ver si lo abrió y, si lo acepta, el lead pasa solo a Ganados.</span>
          </button>
        ) : (
          <ul className="space-y-1.5">
            {suyos.map((p) => {
              const e = estadoVisible(p);
              const aperturas = Number((p as { aperturas?: number }).aperturas ?? 0);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => navigate(`/presupuestos?abrir=${p.id}`)} className="flex w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-xs hover:border-primary/40">
                    <FileText className="h-3.5 w-3.5 text-fuchsia-500" />
                    <span className="font-semibold">#{p.numero}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", ESTADO_PRESUPUESTO[e].clase)}>{ESTADO_PRESUPUESTO[e].label}</span>
                    <span className="ml-auto text-muted-foreground">{aperturas ? `Lo abrió ${aperturas === 1 ? "1 vez" : `${aperturas} veces`}` : "Sin abrir"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Línea de tiempo */}
      {historial.length > 0 && (
        <section className="space-y-2">
          <Titulo>Actividad</Titulo>
          <ol className="relative space-y-0.5">
            {visibles.map((h, i) => {
              const tipo = h.tipo || (h.a ? "paso" : "nota");
              const Icono = ICONO_TIPO[tipo] || CalendarClock;
              const texto = h.texto || (h.a ? `${h.de ? `${NOMBRES_ESTADO[h.de] ?? h.de} → ` : "Entró como "}${NOMBRES_ESTADO[h.a] ?? h.a}` : "");
              return (
                <li key={i} className="relative flex gap-2.5 pb-2.5">
                  {i < visibles.length - 1 && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-border" />}
                  <span className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", COLOR_TIPO[tipo] ?? COLOR_TIPO.nota)}>
                    <Icono className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="whitespace-pre-wrap break-words text-xs leading-snug">{texto}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground" title={fechaHora(h.at)}>
                      {h.por_nombre ? `${h.por_nombre} · ` : ""}
                      {hace(h.at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {historial.length > 5 && (
            <button type="button" onClick={() => setVerTodo(!verTodo)} className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", verTodo && "rotate-180")} />
              {verTodo ? "Ver menos" : `Ver las ${historial.length} actividades`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** Para "Mi día" del admin: los leads con el próximo paso para hoy o atrasado, y los que se están enfriando. */
export function useLeadsDelDia(activo: boolean) {
  const [leads, setLeads] = useState<LeadSeguimiento[]>([]);
  useEffect(() => {
    if (!activo) return;
    return onSnapshot(
      collection(db, "leads_web"),
      (s) => setLeads(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeadSeguimiento, "id">) }))),
      () => setLeads([])
    );
  }, [activo]);
  return useMemo(() => {
    const hoy = hoyISO();
    return leads
      .filter((l) => VIVOS.includes(l.estado))
      .map((l) => {
        const p = l.proximo_paso;
        if (p?.fecha && p.fecha <= hoy) return { lead: l, fecha: p.fecha, tarea: p.texto, etiqueta: p.fecha < hoy ? "Atrasado" : "Hoy" };
        const frio = frioDe(l);
        if (frio && !p) return { lead: l, fecha: hoy, tarea: frio.texto, etiqueta: frio.nivel === "urgente" ? "Urgente" : "Frío" };
        return null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }, [leads]);
}
