import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  AtSign,
  Camera,
  ChevronDown,
  ExternalLink,
  FileText,
  Globe,
  Hand,
  Instagram,
  Loader2,
  Mail,
  MessageCircle,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Settings2,
  Sparkles,
  StickyNote,
  Store,
  Trophy,
  User,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageShell, EmptyState } from "@/components/redes/PageShell";
import { CalendarioEventos, SelectorVista, useVista, type EventoCal, type TipoCal } from "@/components/redes/VistaCalendario";
import { collection, db, doc, onSnapshot } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import { fechaHora, hace, hoyISO } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import { BuscadorMapa, linkMapa, mapaEmbebido, MapaMovible } from "@/components/redes/BuscadorMapa";
import { ProximoPasoChip, SeguimientoLead, type EventoLead } from "@/components/redes/crm/SeguimientoLead";
import { ChatLead } from "@/components/redes/crm/ChatLead";
import { ConectarWhatsApp } from "@/components/redes/crm/ConectarWhatsApp";
import { ConfigCatalogo } from "@/components/redes/crm/CatalogoProductos";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { Handshake } from "lucide-react";

// Reservas de la landing de la campaña «No empezamos de cero» (somosprodi.com).
// Las crea el servidor (/api/web/aplicar); acá se mueven y se anotan (/api/web/estado y /notas).

type Estado = "no_califica" | "calificado" | "reunion_agendada" | "propuesta" | "ganado" | "perdido";

interface LeadWeb {
  id: string;
  created_at: string;
  updated_at: string;
  temporada: string;
  nombre: string;
  negocio: string;
  email: string;
  instagram?: string;
  rubro?: string;
  facturacion_label?: string;
  ya_pauto?: string;
  cuando?: string;
  inversion_label?: string;
  califica: boolean;
  dudoso: boolean;
  estado: Estado;
  notas?: string;
  historial?: EventoLead[];
  /** CRM: qué hay que hacer y para cuándo, y cuándo fue el último contacto. */
  proximo_paso?: { texto: string; fecha: string | null; at: string } | null;
  ultimo_contacto_at?: string | null;
  /** Cargado a mano desde el panel (no vino del formulario de la web). */
  manual?: boolean;
  /** "meta:leadgen": entró solo desde un formulario de un anuncio de Prodi (api/_lib/meta-leads.ts). */
  origen?: string;
  fuente?: string;
  telefono?: string;
  /** Dirección del local o link de Google Maps. */
  ubicacion?: string;
  /** Los que llegaron por Meta: la conversación (mensajes) o el formulario. */
  meta?: { conversacion_id?: string; plataforma?: string; ultimo_texto?: string; foto?: string | null; foto_manual?: string | null; wa_id?: string; chat?: { mensajes?: unknown[]; at?: string } | null } | null;
  /** Socio comercial que lo trajo (por su link o cargado desde su panel). */
  socio_id?: string | null;
  socio_nombre?: string | null;
  /** Cliente que salió de este lead (al darlo de alta). */
  cliente_id?: string | null;
}

interface Columna {
  id: Estado;
  titulo: string;
  ayuda: string;
  dot: string;
  /** Raya de color arriba de la columna y número. */
  borde: string;
  texto: string;
}

const COLUMNAS: Columna[] = [
  { id: "calificado", titulo: "Nuevos", ayuda: "Encaja. Falta hablarle o que reserve la videollamada.", dot: "bg-sky-500", borde: "border-t-sky-500", texto: "text-sky-600 dark:text-sky-400" },
  { id: "reunion_agendada", titulo: "Reunión", ayuda: "Tiene la reunión agendada.", dot: "bg-violet-500", borde: "border-t-violet-500", texto: "text-violet-600 dark:text-violet-400" },
  { id: "propuesta", titulo: "Propuesta", ayuda: "Ya tuvo la reunión y le mandaste la propuesta.", dot: "bg-orange-500", borde: "border-t-orange-500", texto: "text-orange-600 dark:text-orange-400" },
  { id: "ganado", titulo: "Ganados", ayuda: "Es cliente: ocupa un cupo (se ve en la web).", dot: "bg-emerald-500", borde: "border-t-emerald-500", texto: "text-emerald-600 dark:text-emerald-400" },
  { id: "perdido", titulo: "Perdidos", ayuda: "No avanzó.", dot: "bg-muted-foreground", borde: "border-t-muted-foreground/50", texto: "text-muted-foreground" },
];

/** De dónde llegó un lead: para la etiqueta de la tarjeta y el filtro. */
type Origen = "web" | "instagram" | "whatsapp" | "formulario" | "mano" | "socio";
const ORIGENES: Record<Origen, { label: string; icono: React.ElementType; clase: string }> = {
  web: { label: "Web", icono: Globe, clase: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  instagram: { label: "Instagram", icono: Instagram, clase: "bg-pink-500/12 text-pink-700 dark:text-pink-300" },
  whatsapp: { label: "WhatsApp", icono: MessageCircle, clase: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  formulario: { label: "Formulario", icono: FileText, clase: "bg-blue-500/12 text-blue-700 dark:text-blue-300" },
  mano: { label: "A mano", icono: Hand, clase: "bg-muted text-muted-foreground" },
  socio: { label: "Vendedor", icono: Handshake, clase: "bg-[#6F40FC]/12 text-[#6F40FC] dark:text-[#a98bff]" },
};
function origenDe(l: LeadWeb): Origen {
  if (l.origen === "socio") return "socio";
  if (l.origen === "meta:mensaje") return "instagram";
  if (l.origen === "meta:whatsapp") return "whatsapp";
  if (l.origen === "meta:leadgen") return "formulario";
  if (l.manual) return "mano";
  return "web";
}

const NOMBRE_ESTADO: Record<Estado, string> = {
  no_califica: "No califica",
  calificado: "Nuevo",
  reunion_agendada: "Reunión",
  propuesta: "Propuesta",
  ganado: "Ganado",
  perdido: "Perdido",
};

const TIPOS_CAL: Record<string, TipoCal> = {
  nueva: { label: "Aplicó", icon: Sparkles, chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30", dot: "bg-sky-500" },
  ganado: { label: "Ganado", icon: Trophy, chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", dot: "bg-emerald-500" },
};

function useLeadsWeb() {
  const [leads, setLeads] = useState<LeadWeb[] | null>(null);
  const [config, setConfig] = useState({ temporada: "Verano 2027", cupos_total: 5 });
  useEffect(
    () =>
      onSnapshot(
        collection(db, "leads_web"),
        (s) => {
          const lista = s.docs.map((d: { id: string; data: () => object }) => ({ id: d.id, ...d.data() }) as LeadWeb);
          let cambio = false;
          for (const l of lista)
            if (movidos.get(l.id) === l.estado) {
              movidos.delete(l.id);
              cambio = true;
            }
          if (cambio) avisarMovidos();
          setLeads(lista);
        },
        () => setLeads([])
      ),
    []
  );
  useEffect(
    () =>
      onSnapshot(doc(db, "web_config", "general"), (s) => {
        const d = s.exists() ? s.data() : null;
        setConfig({
          temporada: typeof d?.temporada === "string" && d.temporada ? d.temporada : "Verano 2027",
          cupos_total: Number(d?.cupos_total) > 0 ? Number(d.cupos_total) : 5,
        });
      }),
    []
  );
  return { leads, config };
}

/** Lo que puso en "Instagram o web": @usuario → instagram.com/usuario; un dominio → https://dominio. */
function linkDe(v?: string): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (/^@?[A-Za-z0-9._]{1,30}$/.test(t) && !t.includes(".")) return `https://instagram.com/${t.replace(/^@/, "")}`;
  if (/^@[A-Za-z0-9._]{1,30}$/.test(t)) return `https://instagram.com/${t.slice(1)}`;
  const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

// Cambios de etapa que se ven al instante, antes de que conteste el servidor (si falla, vuelve atrás).
const movidos = new Map<string, Estado>();
const oyentesMovidos = new Set<() => void>();
const avisarMovidos = () => oyentesMovidos.forEach((f) => f());
function useMovidos() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const f = () => setVersion((v) => v + 1);
    oyentesMovidos.add(f);
    return () => {
      oyentesMovidos.delete(f);
    };
  }, []);
  return version;
}

async function mover(lead: LeadWeb, estado: Estado) {
  if ((movidos.get(lead.id) ?? lead.estado) === estado) return;
  const antes = movidos.get(lead.id);
  movidos.set(lead.id, estado);
  avisarMovidos();
  try {
    await callApi("/api/web/estado", { id: lead.id, estado });
    toast.success(estado === "ganado" ? "Ganado: ocupa un cupo en la web" : `Pasó a «${NOMBRE_ESTADO[estado]}»`);
  } catch (err) {
    if (antes) movidos.set(lead.id, antes);
    else movidos.delete(lead.id);
    avisarMovidos();
    toast.error(err instanceof Error ? err.message : "No se pudo mover");
  }
}

export default function Web() {
  const { leads: leadsBase, config } = useLeadsWeb();
  const versionMovidos = useMovidos();
  // Los leads con los cambios de etapa que todavía no confirmó el servidor.
  const leads = useMemo(
    () => leadsBase?.map((l) => (movidos.has(l.id) ? { ...l, estado: movidos.get(l.id)! } : l)) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leadsBase, versionMovidos]
  );
  const [vista, setVista] = useVista("web");
  const [abierto, setAbierto] = useState<string | null>(null);
  // /web?lead=… (desde "Mi día" o un aviso): abre ese lead.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get("lead");
    if (!id) return;
    setAbierto(id);
    const next = new URLSearchParams(params);
    next.delete("lead");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const [ajustesAbiertos, setAjustes] = useState(false);
  // Temporada, cupos y conexión con Meta / WhatsApp: solo el admin (Ventas trabaja los leads).
  const esAdminCrm = useUserProfileContext().role === "admin";
  const ajustes = ajustesAbiertos && esAdminCrm;
  const [nuevo, setNuevo] = useState(false);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Origen | "todos">("todos");

  const deTemporada = useMemo(() => (leads ?? []).filter((l) => l.temporada === config.temporada), [leads, config.temporada]);
  const porOrigen = useMemo(() => {
    const c: Record<Origen, number> = { web: 0, instagram: 0, whatsapp: 0, formulario: 0, mano: 0, socio: 0 };
    deTemporada.forEach((l) => c[origenDe(l)]++);
    return c;
  }, [deTemporada]);
  // Lo que se ve en el tablero (buscador y filtro por origen).
  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return deTemporada.filter(
      (l) =>
        (filtro === "todos" || origenDe(l) === filtro) &&
        (!q || [l.negocio, l.nombre, l.email, l.telefono, l.instagram, l.rubro].some((v) => String(v ?? "").toLowerCase().includes(q)))
    );
  }, [deTemporada, busca, filtro]);
  const noCalifican = deTemporada.filter((l) => l.estado === "no_califica").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const ganados = deTemporada.filter((l) => l.estado === "ganado").length;
  const lead = (leads ?? []).find((l) => l.id === abierto) ?? null;

  const eventosCal = useMemo<EventoCal[]>(
    () =>
      deTemporada
        .filter((l) => l.estado !== "no_califica")
        .flatMap((l): EventoCal[] => {
          const ev: EventoCal[] = [
            { key: `${l.id}-n`, fecha: hoyISO(new Date(l.created_at)), tipo: "nueva", orden: 0, titulo: l.negocio, detalle: `${l.nombre} · ${NOMBRE_ESTADO[l.estado]}`, onClick: () => setAbierto(l.id) },
          ];
          const gano = [...(l.historial ?? [])].reverse().find((h) => h.a === "ganado");
          if (l.estado === "ganado" && gano)
            ev.push({ key: `${l.id}-g`, fecha: hoyISO(new Date(gano.at)), tipo: "ganado", orden: 1, titulo: l.negocio, detalle: "Ganado", onClick: () => setAbierto(l.id) });
          return ev;
        }),
    [deTemporada]
  );

  const soltar = (estado: Estado, id: string) => {
    setArrastrando(null);
    setSobre(null);
    const l = deTemporada.find((x) => x.id === id);
    if (l) void mover(l, estado);
  };

  return (
    <PageShell
      title="Leads"
      subtitle={`Temporada ${config.temporada} · web, Instagram, formularios y los que cargás a mano`}
      className="max-w-none"
      actions={
        <>
          {deTemporada.length > 0 && <SelectorVista vista={vista} onChange={setVista} />}
          {esAdminCrm && (
            <Button variant="outline" size="icon" onClick={() => setAjustes(true)} title="Temporada, cupos y conexión con Meta" aria-label="Temporada, cupos y conexión con Meta">
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={() => setNuevo(true)} className="bg-gradient-to-r from-primary to-fuchsia-500 shadow-md shadow-primary/25">
            <Plus className="mr-2 h-4 w-4" /> Nuevo lead
          </Button>
        </>
      }
    >
      {/* Resumen: cuántos hay en cada etapa y los cupos de la temporada. */}
      <div className="mb-3 flex flex-wrap items-stretch gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-2xl border bg-card p-1.5">
          {COLUMNAS.map((col, i) => {
            const n = deTemporada.filter((l) => l.estado === col.id).length;
            return (
              <div key={col.id} className="flex min-w-[88px] flex-1 items-center gap-2 rounded-xl px-3 py-2">
                {i > 0 && <span className="-ml-3 mr-1 text-muted-foreground/40">›</span>}
                <span className={cn("h-2 w-2 shrink-0 rounded-full", col.dot)} />
                <span className="min-w-0">
                  <span className={cn("block text-xl font-bold leading-none tabular-nums", n ? col.texto : "text-muted-foreground/50")}>{n}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{col.titulo}</span>
                </span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setAjustes(true)}
          className="flex min-w-[170px] flex-col justify-center gap-1.5 rounded-2xl border bg-card px-4 py-2 text-left transition-colors hover:border-primary/40"
          title="Cambiar la temporada o los cupos"
        >
          <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Trophy className="h-3.5 w-3.5" /> Cupos
            </span>
            <b className={cn("text-sm tabular-nums", ganados >= config.cupos_total ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
              {ganados} de {config.cupos_total}
            </b>
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (ganados / Math.max(1, config.cupos_total)) * 100)}%` }} />
          </span>
        </button>
      </div>

      {/* Buscar y filtrar por de dónde llegó. */}
      {deTemporada.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar negocio, nombre o teléfono" className="h-9 rounded-full pl-9" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["todos", "whatsapp", "instagram", "formulario", "web", "socio", "mano"] as const).map((o) => {
              const n = o === "todos" ? deTemporada.length : porOrigen[o];
              if (o !== "todos" && !n) return null;
              const Icono = o === "todos" ? null : ORIGENES[o].icono;
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => setFiltro(o)}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    filtro === o ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  {Icono && <Icono className="h-3.5 w-3.5" />}
                  {o === "todos" ? "Todos" : ORIGENES[o].label}
                  <span className={cn("tabular-nums", filtro === o ? "opacity-80" : "opacity-60")}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {leads === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : deTemporada.length === 0 ? (
        <EmptyState icon={Globe} title="Todavía no hay aplicaciones" description="Cuando alguien complete el formulario de somosprodi.com aparece acá." />
      ) : vista === "calendario" ? (
        <CalendarioEventos eventos={eventosCal} tipos={TIPOS_CAL} vacio="No hubo aplicaciones este mes." />
      ) : (
        <div className="-mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:snap-none md:px-8">
          <div className="flex min-w-max gap-3 xl:grid xl:min-w-0 xl:grid-cols-5">
            {COLUMNAS.map((col) => {
              const items = visibles.filter((l) => l.estado === col.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
              return (
                <div
                  key={col.id}
                  data-col={col.id}
                  className={cn(
                    "flex w-[82vw] shrink-0 snap-start flex-col rounded-2xl border border-t-4 bg-muted/40 transition-colors sm:w-72 xl:w-auto",
                    col.borde,
                    arrastrando && sobre === col.id && "border-primary bg-primary/10 ring-2 ring-primary/30"
                  )}
                  onDragOver={(ev) => {
                    if (!arrastrando) return;
                    ev.preventDefault();
                    ev.dataTransfer.dropEffect = "move";
                    if (sobre !== col.id) setSobre(col.id);
                  }}
                  onDragLeave={(ev) => !ev.currentTarget.contains(ev.relatedTarget as Node) && setSobre(null)}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    const id = ev.dataTransfer.getData("text/lead-id") || arrastrando;
                    if (id) soltar(col.id, id);
                  }}
                >
                  <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-2.5" title={col.ayuda}>
                    <p className="text-sm font-semibold">{col.titulo}</p>
                    <span className={cn("rounded-full bg-background px-2 py-0.5 text-xs font-bold tabular-nums shadow-sm", items.length ? col.texto : "text-muted-foreground")}>{items.length}</span>
                  </div>
                  <div className="flex min-h-[140px] flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-300px)] md:overflow-y-auto">
                    {items.map((l) => (
                      <div
                        key={l.id}
                        draggable
                        onDragStart={(ev) => {
                          ev.dataTransfer.setData("text/lead-id", l.id);
                          ev.dataTransfer.effectAllowed = "move";
                          setArrastrando(l.id);
                        }}
                        onDragEnd={() => {
                          setArrastrando(null);
                          setSobre(null);
                        }}
                        className={cn("min-w-0 cursor-grab active:cursor-grabbing", arrastrando === l.id && "opacity-40")}
                      >
                        <LeadCard lead={l} onAbrir={() => setAbierto(l.id)} />
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p className={cn("m-1 rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground/70", arrastrando && "border-primary/50 text-primary")}>
                        {arrastrando ? "Soltalo acá" : busca || filtro !== "todos" ? "Nada con ese filtro" : col.ayuda}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {noCalifican.length > 0 && (
        <details className="mt-2 rounded-xl border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">No califican ({noCalifican.length}) · inversión menor a $700.000</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {noCalifican.map((l) => (
              <LeadCard key={l.id} lead={l} onAbrir={() => setAbierto(l.id)} />
            ))}
          </div>
        </details>
      )}

      <LeadDetalle lead={lead} todos={leads ?? []} onClose={() => setAbierto(null)} />
      <NuevoLead open={nuevo} onOpenChange={setNuevo} />
      <AjustesTemporada open={ajustes} onOpenChange={setAjustes} config={config} />
    </PageShell>
  );
}

function copiarEmail(email: string) {
  navigator.clipboard
    .writeText(email)
    .then(() => toast.success("Email copiado"))
    .catch(() => toast.error("No se pudo copiar"));
}

/** Foto de perfil del lead (Instagram) o sus iniciales si no hay o el link venció. */
function AvatarLead({ lead, className }: { lead: LeadWeb; className?: string }) {
  const [fallo, setFallo] = useState(false);
  // La que se cargó a mano manda (WhatsApp no da la foto); si no, la de Instagram.
  const foto = lead.meta?.foto_manual || lead.meta?.foto;
  useEffect(() => setFallo(false), [foto]);
  const iniciales = (lead.negocio || lead.nombre || "?").replace(/^[@+]/, "").slice(0, 2).toUpperCase();
  return foto && !fallo ? (
    <img src={foto} alt="" referrerPolicy="no-referrer" onError={() => setFallo(true)} className={cn("shrink-0 object-cover", className)} />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center bg-gradient-to-br from-primary to-fuchsia-500 font-bold text-white", className)}>{iniciales}</span>
  );
}

/** Botón de acción chico de la tarjeta (solo ícono, con su nombre al pasar el mouse). */
function AccionCard({ href, onClick, titulo, children }: { href?: string; onClick?: () => void; titulo: string; children: React.ReactNode }) {
  const clase = "flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary";
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={clase} title={titulo} aria-label={titulo} onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  ) : (
    <button type="button" className={clase} title={titulo} aria-label={titulo} onClick={onClick}>
      {children}
    </button>
  );
}

function LeadCard({ lead: l, onAbrir }: { lead: LeadWeb; onAbrir: () => void }) {
  const link = linkDe(l.instagram);
  const o = ORIGENES[origenDe(l)];
  const IconoOrigen = o.icono;
  // Un dato clave en vez de la lista entera (el resto está en la ficha).
  const dato = l.inversion_label ? `Invierte ${l.inversion_label}` : l.rubro || (origenDe(l) === "mano" ? l.fuente : "") || "";
  const nota = (l.meta?.ultimo_texto || (l.notas ?? "").replace(/^Escribió por mensaje de \w+:\s*/i, "")).replace(/\s+/g, " ").trim();
  return (
    <div className={cn("group rounded-xl border bg-card p-3 text-sm shadow-sm transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-md", l.dudoso && "border-orange-500/60")}>
      <button type="button" onClick={onAbrir} className="block w-full min-w-0 text-left">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", o.clase)}>
            <IconoOrigen className="h-3 w-3" /> {o.label}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{hace(l.created_at)}</span>
        </span>
        {l.dudoso && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
            <AlertTriangle className="h-3 w-3" /> Revisar: factura menos de $10M
          </span>
        )}
        <span className="mt-2 flex items-center gap-2">
          <AvatarLead lead={l} className="h-8 w-8 rounded-full text-[11px]" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight">{l.negocio}</span>
            {l.nombre && l.nombre !== l.negocio.replace(/^@/, "") && <span className="block truncate text-xs text-muted-foreground">{l.nombre}</span>}
          </span>
        </span>
        {dato && <span className="mt-1.5 inline-block max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{dato}</span>}
        {nota && <span className="mt-1.5 line-clamp-2 block text-xs leading-snug text-foreground/80">“{nota}”</span>}
        <ProximoPasoChip lead={l} />
      </button>
      <div className="mt-2 flex items-center gap-0.5 border-t pt-2">
        {l.telefono && (
          <AccionCard href={`https://wa.me/${l.telefono.replace(/\D/g, "").replace(/^0/, "54")}`} titulo={`WhatsApp ${l.telefono}`}>
            <Phone className="h-3.5 w-3.5" />
          </AccionCard>
        )}
        {l.email && (
          <AccionCard onClick={() => copiarEmail(l.email)} titulo={`Copiar ${l.email}`}>
            <Mail className="h-3.5 w-3.5" />
          </AccionCard>
        )}
        {link && (
          <AccionCard href={link} titulo={link.includes("instagram.com") ? "Abrir Instagram" : "Abrir la web"}>
            {link.includes("instagram.com") ? <Instagram className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
          </AccionCard>
        )}
        {l.ubicacion && (
          <AccionCard href={linkMapa(l.ubicacion)} titulo={`Mapa: ${l.ubicacion}`}>
            <MapPin className="h-3.5 w-3.5" />
          </AccionCard>
        )}
        {/* Mover de etapa (en la compu también se arrastra la tarjeta). */}
        <label className="relative ml-auto flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          Mover
          <ChevronDown className="h-3 w-3" />
          <select value={l.estado} onChange={(e) => void mover(l, e.target.value as Estado)} aria-label="Mover a" className="absolute inset-0 cursor-pointer opacity-0">
            {(Object.keys(NOMBRE_ESTADO) as Estado[]).map((e) => (
              <option key={e} value={e}>
                {NOMBRE_ESTADO[e]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

type CampoLead = "nombre" | "telefono" | "email" | "instagram" | "ubicacion" | "rubro";
const CAMPOS_LEAD: { k: CampoLead; label: string; icono: React.ElementType; placeholder: string }[] = [
  { k: "nombre", label: "Contacto", icono: User, placeholder: "Con quién hablaste" },
  { k: "telefono", label: "WhatsApp", icono: Phone, placeholder: "Ej.: 3482 123456" },
  { k: "email", label: "Email", icono: Mail, placeholder: "nombre@negocio.com" },
  { k: "instagram", label: "Instagram o web", icono: AtSign, placeholder: "@usuario o sitio web" },
  { k: "ubicacion", label: "Ubicación", icono: MapPin, placeholder: "Dirección o link de Google Maps" },
  { k: "rubro", label: "Rubro", icono: Store, placeholder: "" },
];

/** Los datos del lead: cada uno se toca para corregirlo y lo que falta se agrega con su botón. */
function DatosLead({ lead }: { lead: LeadWeb }) {
  const [editando, setEditando] = useState<CampoLead | null>(null);
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setEditando(null), [lead.id]);
  const abrir = (k: CampoLead) => {
    setEditando(k);
    setValor(String(lead[k] ?? ""));
  };
  const guardar = async () => {
    if (!editando) return;
    setGuardando(true);
    try {
      await callApi("/api/web/datos", { id: lead.id, [editando]: valor });
      setEditando(null);
      toast.success("Guardado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  const presentes = CAMPOS_LEAD.filter((c) => String(lead[c.k] ?? "").trim() || editando === c.k);
  const faltan = CAMPOS_LEAD.filter((c) => !presentes.includes(c));
  const extra = [
    ["Facturación", lead.facturacion_label],
    ["Inversión mensual", lead.inversion_label],
    ["Ya pautó", lead.ya_pauto],
    ["Quiere arrancar", lead.cuando],
  ].filter(([, v]) => v);

  const tel = (lead.telefono ?? "").replace(/\D/g, "");
  const ig = linkDe(lead.instagram);
  // Lo que se puede hacer con un toque (solo con los datos que hay).
  const acciones = [
    tel && { label: "WhatsApp", icono: MessageCircle, href: `https://wa.me/${tel.replace(/^0/, "54")}`, clase: "bg-emerald-500 text-white hover:bg-emerald-600" },
    tel && { label: "Llamar", icono: Phone, href: `tel:${tel}`, clase: "" },
    lead.email && { label: "Mail", icono: Mail, onClick: () => copiarEmail(lead.email), clase: "" },
    ig && { label: ig.includes("instagram.com") ? "Instagram" : "Web", icono: ig.includes("instagram.com") ? Instagram : ExternalLink, href: ig, clase: "" },
    lead.ubicacion && { label: "Llegar", icono: MapPin, href: linkMapa(lead.ubicacion), clase: "" },
  ].filter(Boolean) as { label: string; icono: React.ElementType; href?: string; onClick?: () => void; clase: string }[];

  const editor = (k: CampoLead, placeholder: string) => (
    <div className="col-span-full flex items-start gap-2 rounded-xl border border-primary/50 bg-primary/[0.04] p-2">
      {k === "rubro" ? (
        <select value={valor} onChange={(e) => setValor(e.target.value)} className="h-9 flex-1 rounded-lg border bg-background px-2 text-sm" autoFocus>
          <option value="">Sin rubro</option>
          {RUBROS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : k === "ubicacion" ? (
        <BuscadorMapa valor={valor} onCambiar={setValor} onEnter={() => void guardar()} className="min-w-0 flex-1" autoFocus />
      ) : (
        <Input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void guardar();
            if (e.key === "Escape") setEditando(null);
          }}
          placeholder={placeholder}
          className="h-9 flex-1 bg-background"
          autoFocus
        />
      )}
      <Button size="sm" className="h-9 rounded-lg" onClick={() => void guardar()} disabled={guardando}>
        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
      </Button>
      <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setEditando(null)} aria-label="Cancelar">
        <XCircle className="h-4 w-4" />
      </Button>
    </div>
  );

  const nombre = String(lead.nombre ?? "").trim();
  const iniciales =
    nombre
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";
  const filas = presentes.filter((c) => c.k !== "nombre");
  const lapiz = (k: CampoLead, label: string) => (
    <button
      type="button"
      onClick={() => abrir(k)}
      className="shrink-0 rounded-full p-1.5 text-muted-foreground/70 transition-opacity hover:bg-muted hover:text-foreground md:opacity-0 [@media(hover:none)]:md:opacity-100 md:group-hover:opacity-100"
      aria-label={`Cambiar ${label}`}
      title={`Cambiar ${label.toLowerCase()}`}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border bg-card">
        {/* Quién es y lo que se puede hacer con un toque. */}
        <div className="space-y-3 p-3">
          {editando === "nombre" ? (
            editor("nombre", CAMPOS_LEAD[0].placeholder)
          ) : (
            <div className="group flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{iniciales}</span>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate font-semibold", !nombre && "text-muted-foreground")}>{nombre || "Sin nombre"}</p>
                <p className="text-[11px] text-muted-foreground">Contacto</p>
              </div>
              {lapiz("nombre", "Contacto")}
            </div>
          )}
          {acciones.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {acciones.map((a) => {
                const Icono = a.icono;
                const contenido = (
                  <>
                    <span
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                        a.clase || "bg-muted text-foreground group-hover/acc:bg-primary/10 group-hover/acc:text-primary"
                      )}
                    >
                      <Icono className="h-4 w-4" />
                    </span>
                    <span className="text-[11px] font-medium text-muted-foreground group-hover/acc:text-foreground">{a.label}</span>
                  </>
                );
                const clase = "group/acc flex w-12 flex-col items-center gap-1";
                return a.href ? (
                  <a key={a.label} href={a.href} target={a.href.startsWith("tel:") ? undefined : "_blank"} rel="noopener noreferrer" className={clase}>
                    {contenido}
                  </a>
                ) : (
                  <button key={a.label} type="button" onClick={a.onClick} className={clase}>
                    {contenido}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Cada dato en su renglón: se toca el lápiz para corregirlo. */}
        {filas.length > 0 && (
          <div className="divide-y border-t">
            {filas.map(({ k, label, icono: Icono, placeholder }) => {
              if (editando === k) return <div key={k} className="p-2">{editor(k, placeholder)}</div>;
              const v = String(lead[k] ?? "");
              return (
                <div key={k} className="group px-3 py-2">
                  <div className="flex items-center gap-3">
                    <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-muted-foreground">{label}</p>
                      <p className="truncate text-sm font-medium" title={v}>
                        {k === "ubicacion" && /^https?:/i.test(v) ? "Link de Google Maps" : v}
                      </p>
                    </div>
                    {lapiz(k, label)}
                  </div>
                  {k === "ubicacion" && mapaEmbebido(v) && <MapaMovible ubicacion={v} className="mt-2 h-36 overflow-hidden rounded-lg" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {faltan.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Falta:</span>
          {faltan.map(({ k, label, icono: Icono }) => (
            <button
              key={k}
              type="button"
              onClick={() => abrir(k)}
              className="flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="h-3 w-3" />
              <Icono className="h-3 w-3" /> {label}
            </button>
          ))}
        </div>
      )}

      {extra.length > 0 && (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-2.5">
          <p className="col-span-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lo que puso en la web</p>
          {extra.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <p className="text-[10px] text-muted-foreground">{k}</p>
              <p className="truncate text-xs font-medium" title={v}>
                {v}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Etapa del lead: botones con su color (en vez de un desplegable). */
function SelectorEtapa({ lead }: { lead: LeadWeb }) {
  return (
    <div className="grid grid-cols-5 gap-1 rounded-xl bg-muted/70 p-1">
      {COLUMNAS.map((c) => {
        const activa = lead.estado === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => void mover(lead, c.id)}
            title={c.ayuda}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-[background-color,box-shadow,color] duration-100 active:scale-95",
              activa ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className={cn("h-1.5 w-6 rounded-full", activa ? c.dot : "bg-muted-foreground/25")} />
            <span className="truncate">{c.titulo}</span>
          </button>
        );
      })}
    </div>
  );
}

function Bloque({ titulo, children, accion }: { titulo: string; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</p>
        {accion}
      </div>
      {children}
    </section>
  );
}

/** Los últimos 10 dígitos del teléfono (para reconocer a la misma persona en dos canales). */
const claveTel = (t?: string) => {
  const d = (t ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-10) : "";
};
const claveIg = (v?: string) => (v ?? "").trim().replace(/^@/, "").toLowerCase();

/** Otros leads que parecen la misma persona (mismo teléfono o mismo Instagram). */
function mismaPersona(lead: LeadWeb, todos: LeadWeb[]): LeadWeb[] {
  const tel = claveTel(lead.telefono);
  const ig = claveIg(lead.instagram);
  return todos.filter((o) => o.id !== lead.id && ((tel && claveTel(o.telefono) === tel) || (ig && !ig.includes(".") && claveIg(o.instagram) === ig)));
}

/** Foto achicada a 320 px en JPEG, como data URL (para guardarla en el lead). */
async function fotoChica(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const lado = 320;
  const k = Math.max(lado / bmp.width, lado / bmp.height);
  const c = document.createElement("canvas");
  c.width = lado;
  c.height = lado;
  // Recorte cuadrado al centro.
  c.getContext("2d")!.drawImage(bmp, (lado - bmp.width * k) / 2, (lado - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  return c.toDataURL("image/jpeg", 0.85);
}

/** El avatar de la ficha: se toca para subir una foto (o cambiarla). */
function AvatarEditable({ lead }: { lead: LeadWeb }) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const elegir = async (f?: File) => {
    if (!f) return;
    setSubiendo(true);
    try {
      await callApi("/api/web/foto", { id: lead.id, foto: await fotoChica(f) });
      toast.success("Foto guardada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la foto");
    } finally {
      setSubiendo(false);
    }
  };
  const quitar = async () => {
    try {
      await callApi("/api/web/foto", { id: lead.id, foto: "" });
      toast.success("Foto sacada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo sacar");
    }
  };
  return (
    <div className="group relative shrink-0">
      <button type="button" onClick={() => input.current?.click()} title="Cambiar la foto" className="relative block">
        <AvatarLead lead={lead} className="h-11 w-11 rounded-2xl text-sm shadow-md shadow-primary/25" />
        <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
          {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </span>
      </button>
      {lead.meta?.foto_manual && (
        <button
          type="button"
          onClick={() => void quitar()}
          className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow group-hover:flex hover:text-foreground"
          title="Sacar la foto"
          aria-label="Sacar la foto"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => (void elegir(e.target.files?.[0]), (e.target.value = ""))} />
    </div>
  );
}

/** Aviso cuando la misma persona está en otro lead (ej. por WhatsApp y por Instagram), con el botón para unirlos. */
function AvisoMismaPersona({ lead, otros }: { lead: LeadWeb; otros: LeadWeb[] }) {
  const [uniendo, setUniendo] = useState<string | null>(null);
  if (!otros.length) return null;
  const unir = async (o: LeadWeb) => {
    setUniendo(o.id);
    try {
      await callApi("/api/web/unir", { id: lead.id, otro: o.id });
      toast.success("Unidos: ahora es un solo lead");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron unir");
    } finally {
      setUniendo(null);
    }
  };
  return (
    <div className="space-y-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 p-2.5">
      {otros.map((o) => {
        const og = ORIGENES[origenDe(o)];
        return (
          <div key={o.id} className="flex items-center gap-2">
            <AvatarLead lead={o} className="h-7 w-7 rounded-full text-[10px]" />
            <p className="min-w-0 flex-1 text-xs">
              <span className="font-semibold">Parece la misma persona</span> que <b>{o.negocio}</b>
              <span className="text-muted-foreground"> · {og.label}</span>
            </p>
            <Button size="sm" className="h-7 shrink-0 rounded-full px-3 text-[11px]" onClick={() => void unir(o)} disabled={!!uniendo}>
              {uniendo === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Unir"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function LeadDetalle({ lead, todos, onClose }: { lead: LeadWeb | null; todos: LeadWeb[]; onClose: () => void }) {
  const [notas, setNotas] = useState("");
  const [pestana, setPestana] = useState<"chat" | "ficha">("chat");
  useEffect(() => setPestana("chat"), [lead?.id]);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setNotas(lead?.notas ?? ""), [lead?.id, lead?.notas]);
  if (!lead) return null;
  const guardar = async () => {
    setGuardando(true);
    try {
      await callApi("/api/web/notas", { id: lead.id, notas });
      toast.success("Notas guardadas");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron guardar");
    } finally {
      setGuardando(false);
    }
  };
  const o = ORIGENES[origenDe(lead)];
  const IconoOrigen = o.icono;
  // También el que entró por la web y se unió con el de Instagram: la conversación viene con la unión.
  const conChat = !!lead.meta?.conversacion_id;
  const cambioNotas = notas !== (lead.notas ?? "");

  const datos = (
    <div className="space-y-4">
      {lead.dudoso && (
        <p className="flex items-center gap-2 rounded-xl border border-orange-500/50 bg-orange-500/10 p-3 text-sm font-medium text-orange-700 dark:text-orange-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Revisar: dice que invierte más de $700.000 pero factura menos de $10M por mes.
        </p>
      )}
      <AvisoMismaPersona lead={lead} otros={mismaPersona(lead, todos)} />
      <Bloque titulo="Etapa">
        <SelectorEtapa lead={lead} />
      </Bloque>
      <Bloque titulo="Datos">
        <DatosLead lead={lead} />
      </Bloque>
      <TraidoPor lead={lead} />
      <Bloque
        titulo="Notas"
        accion={
          cambioNotas && (
            <Button onClick={() => void guardar()} disabled={guardando} size="sm" className="h-7 rounded-full px-3 text-xs">
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
          )
        }
      >
        <Textarea
          rows={2}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder={conChat ? "Lo que no está en el chat: qué necesita, presupuesto, cómo siguió…" : "Cómo fue la reunión, qué propuesta le mandaste…"}
          className="min-h-[64px] rounded-xl"
        />
      </Bloque>
      <SeguimientoLead lead={lead} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("flex max-h-[92dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden rounded-3xl bg-background p-0", conChat ? "h-[min(860px,92dvh)] max-w-5xl" : "max-w-xl")}>
        {/* Encabezado */}
        <DialogHeader className="shrink-0 flex-row items-center gap-3 space-y-0 border-b bg-gradient-to-r from-primary/[0.08] via-fuchsia-500/[0.05] to-transparent px-5 py-3.5 pr-12 text-left">
          <AvatarEditable lead={lead} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-lg">{lead.negocio}</DialogTitle>
            <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", o.clase)}>
                <IconoOrigen className="h-3 w-3" /> {o.label}
              </span>
              {lead.nombre && lead.nombre !== lead.negocio.replace(/^@/, "") && <span>{lead.nombre}</span>}
              <span>· llegó {hace(lead.created_at)}</span>
              <span className="hidden sm:inline">· {fechaHora(lead.created_at)}</span>
            </DialogDescription>
          </div>
        </DialogHeader>

        {conChat ? (
          <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {/* En el celular: una cosa por vez (chat o ficha). En la compu, lado a lado. */}
            <div className="grid shrink-0 grid-cols-2 gap-1 border-b p-1.5 md:hidden">
              {(["chat", "ficha"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPestana(p)}
                  className={cn(
                    "rounded-lg py-2 text-sm font-semibold transition-colors",
                    pestana === p ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                  )}
                >
                  {p === "chat" ? "Chat" : "Ficha"}
                </button>
              ))}
            </div>
            <div className={cn("min-h-0 flex-1 md:block md:border-r", pestana === "chat" ? "flex flex-col" : "hidden")}>
              <ChatLead lead={lead} />
            </div>
            <div className={cn("min-h-0 flex-1 overflow-y-auto bg-background p-4 md:block", pestana === "ficha" ? "block" : "hidden")}>{datos}</div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{datos}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Socios comerciales (para el "Traído por"): se piden una vez. */
let sociosCache: Promise<{ uid: string; nombre: string; activo: boolean; codigo: string | null }[]> | null = null;
function useSociosLista() {
  const [lista, setLista] = useState<{ uid: string; nombre: string; activo: boolean; codigo: string | null }[]>([]);
  useEffect(() => {
    sociosCache ??= callApi<{ socios: { uid: string; nombre: string; activo: boolean; codigo: string | null }[] }>("/api/web/socio-lista", {})
      .then((r) => r.socios)
      .catch(() => {
        sociosCache = null;
        return [];
      });
    void sociosCache.then(setLista);
  }, []);
  return lista;
}

/** "Traído por": el socio comercial del lead (se asigna o cambia a mano) y, si se ganó, darlo de alta como cliente. */
function TraidoPor({ lead }: { lead: LeadWeb }) {
  const navigate = useNavigate();
  const socios = useSociosLista();
  const [guardando, setGuardando] = useState(false);
  if (!socios.length && !lead.socio_id && lead.estado !== "ganado") return null;
  const cambiar = async (uid: string) => {
    setGuardando(true);
    try {
      await callApi("/api/web/socio-asignar", { id: lead.id, socio_id: uid || null });
      toast.success(uid ? "Socio asignado" : "Sin socio");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Bloque titulo="Traído por">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 shrink-0 text-[#6F40FC]" />
          <select
            value={lead.socio_id ?? ""}
            onChange={(e) => void cambiar(e.target.value)}
            disabled={guardando}
            className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm"
            aria-label="Vendedor que lo trajo"
          >
            <option value="">Nadie (lo trajo Prodi)</option>
            {lead.socio_id && !socios.some((s) => s.uid === lead.socio_id) && <option value={lead.socio_id}>{lead.socio_nombre || "Socio"}</option>}
            {socios.map((s) => (
              <option key={s.uid} value={s.uid}>
                {s.nombre}
                {!s.activo ? " (desactivado)" : ""}
              </option>
            ))}
          </select>
        </div>
        {lead.estado === "ganado" &&
          (lead.cliente_id ? (
            <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => navigate(`/clientes/${lead.cliente_id}`)}>
              Ver el cliente
            </Button>
          ) : (
            <Button size="sm" className="h-9 rounded-full" onClick={() => navigate(`/clientes?lead=${lead.id}`)}>
              <UserPlus className="mr-1.5 h-4 w-4" /> Dar de alta el cliente
            </Button>
          ))}
        {lead.socio_id && <p className="text-[11px] text-muted-foreground">Al darlo de alta, el cliente queda con este socio y cobra comisión de lo que pague.</p>}
      </div>
    </Bloque>
  );
}

/** Los formularios de los anuncios de Prodi en Meta entran solos como leads (api/_lib/meta-leads.ts). */
function FormulariosMeta() {
  const [conectando, setConectando] = useState(false);
  const [token, setToken] = useState("");
  // Si Meta está avisando al momento (webhook) o el sistema lo va a buscar cada tanto.
  const [estado, setEstado] = useState<{ conectado: boolean; ultimo_aviso: string | null; ultima_revision: string | null } | null>(null);
  useEffect(() => {
    callApi<typeof estado>("/api/web/meta-estado", {})
      .then(setEstado)
      .catch(() => undefined);
  }, [conectando]);
  const usarToken = async () => {
    setConectando(true);
    try {
      const r = await callApi<{ pagina: string; formularios: number; nuevos: number }>("/api/web/meta-token", { token: token.trim() });
      setToken("");
      toast.success(`Conectado a ${r.pagina}: ${r.formularios} formulario${r.formularios === 1 ? "" : "s"}, ${r.nuevos} lead${r.nuevos === 1 ? "" : "s"} nuevo${r.nuevos === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo conectar");
    } finally {
      setConectando(false);
    }
  };
  const traerMensajes = async () => {
    setConectando(true);
    try {
      const r = await callApi<{ nuevos: number; errores?: string[]; detalle?: string[] }>("/api/web/meta-mensajes", { forzar: true });
      if (r.errores?.length) toast.warning(r.errores.join(" · "), { duration: 20000 });
      toast.success(`${r.nuevos ? `${r.nuevos} lead${r.nuevos === 1 ? "" : "s"} nuevo${r.nuevos === 1 ? "" : "s"} por mensaje` : "No hay conversaciones nuevas"}${r.detalle?.length ? ` · ${r.detalle.join(" · ")}` : ""}`, { duration: 15000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron traer los mensajes");
    } finally {
      setConectando(false);
    }
  };
  const conectar = async () => {
    setConectando(true);
    try {
      const r = await callApi<{ pagina: string; formularios: number; nuevos: number }>("/api/web/meta-conectar", {});
      toast.success(`Conectado a ${r.pagina}: ${r.formularios} formulario${r.formularios === 1 ? "" : "s"}, ${r.nuevos} lead${r.nuevos === 1 ? "" : "s"} nuevo${r.nuevos === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo conectar");
    } finally {
      setConectando(false);
    }
  };
  return (
    <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
      <p className="text-sm font-semibold">Formularios de los anuncios</p>
      <p className="text-xs text-muted-foreground">Los que llenan el formulario de un anuncio de Prodi en Instagram o Facebook entran solos acá, con aviso. Conectalo una vez; también trae los de los últimos 30 días.</p>
      <Button size="sm" variant="outline" className="w-full" onClick={() => void conectar()} disabled={conectando}>
        {conectando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
        Conectar y traer formularios de Meta
      </Button>
      {estado?.conectado && (
        <p className={cn("rounded-lg px-2.5 py-1.5 text-[11px]", estado.ultimo_aviso ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
          {estado.ultimo_aviso
            ? `Al instante: Meta avisó el último mensaje ${hace(estado.ultimo_aviso)}.`
            : "Meta todavía no avisó ningún mensaje al instante: se revisa solo cada 2 minutos con el sistema abierto."}
          {estado.ultima_revision ? ` Última revisión ${hace(estado.ultima_revision)}.` : ""}
        </p>
      )}
      <Button size="sm" variant="outline" className="w-full" onClick={() => void traerMensajes()} disabled={conectando}>
        <MessageCircle className="mr-2 h-4 w-4" /> Traer mensajes de Instagram y Facebook
      </Button>
      <div className="space-y-1.5 border-t pt-2">
        <p className="text-[11px] text-muted-foreground">
          Si Meta pide <b>leads_retrieval</b>: pegá acá el identificador de acceso de tu usuario (Gestor Prodi → Herramientas), ampliado en el Depurador de tokens de Meta, y tocá Usar.
        </p>
        <div className="flex gap-1.5">
          <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAA…" className="h-9 text-xs" type="password" autoComplete="off" />
          <Button size="sm" className="h-9" onClick={() => void usarToken()} disabled={conectando || token.trim().length < 20}>
            Usar
          </Button>
        </div>
      </div>
    </div>
  );
}

function AjustesTemporada({ open, onOpenChange, config }: { open: boolean; onOpenChange: (o: boolean) => void; config: { temporada: string; cupos_total: number } }) {
  const [temporada, setTemporada] = useState(config.temporada);
  const [cupos, setCupos] = useState(String(config.cupos_total));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTemporada(config.temporada);
    setCupos(String(config.cupos_total));
  }, [open, config.temporada, config.cupos_total]);
  const guardar = async () => {
    setGuardando(true);
    try {
      await callApi("/api/web/config", { temporada: temporada.trim(), cupos_total: Number(cupos) });
      toast.success("Guardado: la web ya muestra los cupos nuevos");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>Temporada y cupos</DialogTitle>
          <DialogDescription>Las aplicaciones nuevas quedan en esta temporada. Los cupos ocupados son los ganados de la temporada.</DialogDescription>
        </DialogHeader>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Temporada</span>
          <Input value={temporada} onChange={(e) => setTemporada(e.target.value)} maxLength={40} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Cupos</span>
          <Input type="number" min={1} max={50} value={cupos} onChange={(e) => setCupos(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <XCircle className="mr-2 h-4 w-4" /> Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
        <FormulariosMeta />
        <ConectarWhatsApp />
        <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
          <p className="text-sm font-semibold">Catálogo de productos</p>
          <ConfigCatalogo negocio="prodi" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

const FUENTES = ["WhatsApp", "Recomendación", "Instagram", "Llamada", "Evento", "Cliente actual", "Otro"];
const RUBROS = ["Comercio", "Industria / fábrica", "Gastronomía", "Servicios profesionales", "Salud y bienestar", "Otro"];

/** Campo con su ícono adentro. */
function CampoIcono({ icono: Icono, className, ...props }: React.ComponentProps<typeof Input> & { icono: React.ElementType }) {
  return (
    <div className={cn("relative", className)}>
      <Icono className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input {...props} className="h-11 rounded-xl pl-9" />
    </div>
  );
}

/** Desplegable chico con forma de etiqueta ("Llegó por WhatsApp ▾"). */
function Etiqueta({
  icono: Icono,
  prefijo,
  valor,
  opciones,
  onCambiar,
  vacio,
  punto,
}: {
  icono?: React.ElementType;
  prefijo: string;
  valor: string;
  opciones: { id: string; label: string }[];
  onCambiar: (v: string) => void;
  vacio?: string;
  punto?: string;
}) {
  const actual = opciones.find((o) => o.id === valor);
  return (
    <label className="relative flex cursor-pointer items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs transition-colors hover:border-primary/50">
      {punto ? <span className={cn("h-2 w-2 rounded-full", punto)} /> : Icono && <Icono className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className="text-muted-foreground">{prefijo}</span>
      <span className="font-semibold">{actual?.label ?? vacio}</span>
      <ChevronDown className="h-3 w-3 text-muted-foreground" />
      <select value={valor} onChange={(e) => onCambiar(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={prefijo}>
        {vacio && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Cargar un lead a mano (un contacto que llegó por WhatsApp, una recomendación, un evento…): va al mismo tablero. */
function NuevoLead({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const vacio = { negocio: "", nombre: "", telefono: "", email: "", instagram: "", ubicacion: "", rubro: "", fuente: "WhatsApp", estado: "calificado" as Estado, notas: "" };
  const [f, setF] = useState(vacio);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (open) setF(vacio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof typeof vacio, v: string) => setF((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    setGuardando(true);
    try {
      await callApi("/api/web/manual", f);
      toast.success("Lead cargado");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  // Lo opcional aparece de a uno, cuando se pide.
  const [mas, setMas] = useState<("email" | "instagram" | "ubicacion" | "notas")[]>([]);
  useEffect(() => {
    if (open) setMas([]);
  }, [open]);
  const listo = f.negocio.trim().length >= 2;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md gap-0 rounded-3xl p-0">
        <DialogHeader className="px-6 pb-3 pt-6 text-left">
          <DialogTitle className="flex items-center gap-2.5 text-xl">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/25">
              <UserPlus className="h-4 w-4" />
            </span>
            Nuevo lead
          </DialogTitle>
          <DialogDescription className="sr-only">Un contacto que llegó por fuera de la web.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 px-6 pb-5">
          <CampoIcono icono={Store} value={f.negocio} onChange={(e) => set("negocio", e.target.value)} placeholder="¿Qué negocio es?" maxLength={80} autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <CampoIcono icono={User} value={f.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Con quién" maxLength={80} />
            <CampoIcono icono={Phone} value={f.telefono} onChange={(e) => set("telefono", e.target.value)} placeholder="WhatsApp" inputMode="tel" maxLength={40} />
          </div>
          {mas.includes("email") && <CampoIcono icono={Mail} value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="Email" inputMode="email" maxLength={120} autoFocus />}
          {mas.includes("instagram") && <CampoIcono icono={AtSign} value={f.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="Instagram o web" maxLength={120} autoFocus />}
          {mas.includes("ubicacion") && <BuscadorMapa valor={f.ubicacion} onCambiar={(v) => set("ubicacion", v)} autoFocus />}
          {mas.includes("notas") && (
            <Textarea value={f.notas} onChange={(e) => set("notas", e.target.value)} rows={2} placeholder="Qué necesita, cuándo volver a llamar…" className="rounded-xl" autoFocus />
          )}
          {mas.length < 4 && (
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["email", Mail, "Email"],
                  ["instagram", AtSign, "Instagram o web"],
                  ["ubicacion", MapPin, "Ubicación"],
                  ["notas", StickyNote, "Nota"],
                ] as const
              )
                .filter(([id]) => !mas.includes(id))
                .map(([id, Icono, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMas((m) => [...m, id])}
                    className="flex items-center gap-1.5 rounded-full border border-dashed border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <Plus className="h-3 w-3" />
                    <Icono className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Etiqueta prefijo="Llegó por" valor={f.fuente} opciones={FUENTES.map((x) => ({ id: x, label: x }))} onCambiar={(v) => set("fuente", v)} />
            <Etiqueta prefijo="Rubro" valor={f.rubro} vacio="elegir" opciones={RUBROS.map((x) => ({ id: x, label: x }))} onCambiar={(v) => set("rubro", v)} />
            <Etiqueta
              prefijo="Etapa"
              valor={f.estado}
              punto={COLUMNAS.find((c) => c.id === f.estado)?.dot}
              opciones={COLUMNAS.map((c) => ({ id: c.id, label: c.titulo }))}
              onCambiar={(v) => set("estado", v)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-6 py-3">
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => void guardar()}
            disabled={guardando || !listo}
            className="rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-6 font-semibold shadow-md shadow-primary/25"
          >
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
