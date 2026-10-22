import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  AtSign,
  ChevronDown,
  CalendarCheck,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Settings2,
  Sparkles,
  StickyNote,
  Store,
  Trophy,
  User,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageShell, EmptyState, StatCard } from "@/components/redes/PageShell";
import { CalendarioEventos, SelectorVista, useVista, type EventoCal, type TipoCal } from "@/components/redes/VistaCalendario";
import { collection, db, doc, onSnapshot } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import { fechaHora, hace, hoyISO } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import { BuscadorMapa, linkMapa, mapaEmbebido, MapaMovible } from "@/components/redes/BuscadorMapa";

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
  historial?: { at: string; de: string | null; a: string; por_nombre?: string }[];
  /** Cargado a mano desde el panel (no vino del formulario de la web). */
  manual?: boolean;
  fuente?: string;
  telefono?: string;
  /** Dirección del local o link de Google Maps. */
  ubicacion?: string;
}

interface Columna {
  id: Estado;
  titulo: string;
  ayuda: string;
  dot: string;
}

const COLUMNAS: Columna[] = [
  { id: "calificado", titulo: "Calificado", ayuda: "Encaja. Falta que reserve la videollamada.", dot: "bg-sky-500" },
  { id: "reunion_agendada", titulo: "Reunión agendada", ayuda: "Reservó en la agenda de Google.", dot: "bg-primary" },
  { id: "propuesta", titulo: "Propuesta", ayuda: "Ya tuvo la reunión y le mandaste la propuesta.", dot: "bg-orange-500" },
  { id: "ganado", titulo: "Ganado", ayuda: "Ocupa un cupo (se ve en la web).", dot: "bg-emerald-500" },
  { id: "perdido", titulo: "Perdido", ayuda: "No avanzó.", dot: "bg-muted-foreground" },
];

const NOMBRE_ESTADO: Record<Estado, string> = {
  no_califica: "No califica",
  calificado: "Calificado",
  reunion_agendada: "Reunión agendada",
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
        (s) => setLeads(s.docs.map((d: { id: string; data: () => object }) => ({ id: d.id, ...d.data() }) as LeadWeb)),
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

async function mover(lead: LeadWeb, estado: Estado) {
  if (lead.estado === estado) return;
  try {
    await callApi("/api/web/estado", { id: lead.id, estado });
    toast.success(estado === "ganado" ? "Ganado: ocupa un cupo en la web" : `Pasó a «${NOMBRE_ESTADO[estado]}»`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "No se pudo mover");
  }
}

export default function Web() {
  const { leads, config } = useLeadsWeb();
  const [vista, setVista] = useVista("web");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ajustes, setAjustes] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const deTemporada = useMemo(() => (leads ?? []).filter((l) => l.temporada === config.temporada), [leads, config.temporada]);
  const noCalifican = deTemporada.filter((l) => l.estado === "no_califica").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const calificadas = deTemporada.filter((l) => l.califica).length;
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
      subtitle={`Los de somosprodi.com y los que cargás a mano · temporada ${config.temporada}`}
      className="max-w-none"
      actions={
        <>
          {deTemporada.length > 0 && <SelectorVista vista={vista} onChange={setVista} />}
          <Button variant="outline" onClick={() => setAjustes(true)}>
            <Settings2 className="mr-2 h-4 w-4" /> Temporada y cupos
          </Button>
          <Button onClick={() => setNuevo(true)} className="bg-gradient-to-r from-primary to-fuchsia-500 shadow-md shadow-primary/25">
            <Plus className="mr-2 h-4 w-4" /> Nuevo lead
          </Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard label="Aplicaciones" value={deTemporada.length} hint={`en ${config.temporada}`} icon={FileText} />
        <StatCard label="Calificadas" value={calificadas} hint={`${noCalifican.length} no califican`} icon={CalendarCheck} tone="primary" />
        <StatCard label="Cupos" value={`${ganados} de ${config.cupos_total}`} hint="ocupados (los ganados)" icon={Trophy} tone={ganados >= config.cupos_total ? "success" : "default"} />
      </div>

      {leads === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : deTemporada.length === 0 ? (
        <EmptyState icon={Globe} title="Todavía no hay aplicaciones" description="Cuando alguien complete el formulario de somosprodi.com aparece acá." />
      ) : vista === "calendario" ? (
        <CalendarioEventos eventos={eventosCal} tipos={TIPOS_CAL} vacio="No hubo aplicaciones este mes." />
      ) : (
        <div className="-mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:snap-none md:px-8">
          <div className="flex min-w-max gap-3">
            {COLUMNAS.map((col) => {
              const items = deTemporada.filter((l) => l.estado === col.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
              return (
                <div
                  key={col.id}
                  data-col={col.id}
                  className={cn(
                    "flex w-[82vw] shrink-0 snap-start flex-col rounded-2xl border bg-muted/30 transition-colors sm:w-72",
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
                  <div className="flex items-center justify-between gap-2 px-3 pt-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                      <p className="text-sm font-semibold">{col.titulo}</p>
                    </div>
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">{items.length}</span>
                  </div>
                  <p className="px-3 pb-2 pt-1 text-[11px] leading-snug text-muted-foreground">{col.ayuda}</p>
                  <div className="flex min-h-[120px] flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-330px)] md:overflow-y-auto">
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
                    {items.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground/70">{arrastrando ? "Soltala acá" : "Vacío"}</p>}
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

      <LeadDetalle lead={lead} onClose={() => setAbierto(null)} />
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

function Dato({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <span className="block truncate text-[11px] text-muted-foreground">
      {k}: <span className="text-foreground">{v}</span>
    </span>
  );
}

function LeadCard({ lead: l, onAbrir }: { lead: LeadWeb; onAbrir: () => void }) {
  const link = linkDe(l.instagram);
  return (
    <div className={cn("rounded-xl border bg-card p-2.5 text-sm transition-colors hover:border-primary/50", l.dudoso && "border-orange-500/60")}>
      <button type="button" onClick={onAbrir} className="block w-full min-w-0 text-left">
        {l.dudoso && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            <AlertTriangle className="h-3 w-3" /> Revisar: factura menos de $10M
          </span>
        )}
        {l.manual && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
            Cargado a mano{l.fuente ? ` · ${l.fuente}` : ""}
          </span>
        )}
        <span className="block truncate font-semibold">{l.negocio}</span>
        <span className="block truncate text-xs text-muted-foreground">{l.nombre}</span>
        <span className="mt-1.5 block space-y-0.5">
          <Dato k="Rubro" v={l.rubro} />
          <Dato k="Factura" v={l.facturacion_label} />
          <Dato k="Invierte" v={l.inversion_label} />
          <Dato k="Arrancar" v={l.cuando} />
          <Dato k="Pautó" v={l.ya_pauto} />
        </span>
        {l.notas && <span className="mt-1 line-clamp-2 block text-[11px] italic text-muted-foreground">“{l.notas}”</span>}
      </button>
      <div className="mt-2 flex items-center gap-1">
        {l.email && (
          <button type="button" onClick={() => copiarEmail(l.email)} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10" title={l.email}>
            <Copy className="h-3 w-3" /> Email
          </button>
        )}
        {l.telefono && (
          <a
            href={`https://wa.me/${l.telefono.replace(/\D/g, "").replace(/^0/, "54")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
            title={l.telefono}
          >
            <Phone className="h-3 w-3" /> WhatsApp
          </a>
        )}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10">
            <ExternalLink className="h-3 w-3" /> {link.includes("instagram.com") ? "Instagram" : "Web"}
          </a>
        )}
        {l.ubicacion && (
          <a
            href={linkMapa(l.ubicacion)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
            title={l.ubicacion}
          >
            <MapPin className="h-3 w-3" /> Mapa
          </a>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">{hace(l.created_at)}</span>
      </div>
      {/* En el celular o el iPad: mover con el selector (el arrastre es para la compu). */}
      <select
        value={l.estado}
        onChange={(e) => void mover(l, e.target.value as Estado)}
        aria-label="Mover a"
        className="mt-1.5 h-8 w-full rounded-lg border bg-background px-2 text-xs"
      >
        {(Object.keys(NOMBRE_ESTADO) as Estado[]).map((e) => (
          <option key={e} value={e}>
            {NOMBRE_ESTADO[e]}
          </option>
        ))}
      </select>
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
  const accion = (k: CampoLead, v: string) => {
    const clase = "text-xs font-medium text-primary hover:underline";
    if (k === "telefono")
      return (
        <a href={`https://wa.me/${v.replace(/\D/g, "").replace(/^0/, "54")}`} target="_blank" rel="noopener noreferrer" className={clase}>
          Escribir
        </a>
      );
    if (k === "email")
      return (
        <button type="button" onClick={() => copiarEmail(v)} className={clase}>
          Copiar
        </button>
      );
    if (k === "instagram" && linkDe(v))
      return (
        <a href={linkDe(v)!} target="_blank" rel="noopener noreferrer" className={clase}>
          Abrir
        </a>
      );
    if (k === "ubicacion")
      return (
        <a href={linkMapa(v)} target="_blank" rel="noopener noreferrer" className={clase}>
          Google Maps
        </a>
      );
    return null;
  };
  const presentes = CAMPOS_LEAD.filter((c) => String(lead[c.k] ?? "").trim() || editando === c.k);
  const faltan = CAMPOS_LEAD.filter((c) => !presentes.includes(c));
  const extra = [
    ["Facturación", lead.facturacion_label],
    ["Inversión mensual", lead.inversion_label],
    ["Ya pautó", lead.ya_pauto],
    ["Quiere arrancar", lead.cuando],
  ].filter(([, v]) => v);

  return (
    <div className="space-y-3 rounded-2xl border p-3">
      <div className="divide-y">
        {presentes.map(({ k, label, icono: Icono, placeholder }) => {
          const v = String(lead[k] ?? "");
          return (
            <div key={k} className="py-2 first:pt-0 last:pb-0">
              {editando === k ? (
                <div className={cn("flex gap-2", k === "ubicacion" ? "items-start" : "items-center")}>
                  <Icono className={cn("h-4 w-4 shrink-0 text-primary", k === "ubicacion" && "mt-3.5")} />
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
                      className="h-9 flex-1"
                      autoFocus
                    />
                  )}
                  <Button size="sm" className="h-9" onClick={() => void guardar()} disabled={guardando}>
                    {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setEditando(null)} aria-label="Cancelar">
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="group flex items-center gap-2 text-sm">
                  <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
                  <span className="min-w-0 flex-1 truncate">{k === "ubicacion" && /^https?:/i.test(v) ? "Link de Google Maps" : v}</span>
                  {accion(k, v)}
                  <button type="button" onClick={() => abrir(k)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Cambiar ${label}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {k === "ubicacion" && editando !== k && mapaEmbebido(v) && (
                <MapaMovible ubicacion={v} className="mt-2 h-48" />
              )}
            </div>
          );
        })}
      </div>
      {faltan.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {faltan.map(({ k, label, icono: Icono }) => (
            <button
              key={k}
              type="button"
              onClick={() => abrir(k)}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="h-3 w-3" />
              <Icono className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      )}
      {extra.length > 0 && (
        <div className="space-y-0.5 rounded-xl bg-muted/50 p-2.5 text-xs">
          <p className="mb-1 font-semibold text-muted-foreground">Lo que puso en la web</p>
          {extra.map(([k, v]) => (
            <p key={k}>
              <span className="text-muted-foreground">{k}:</span> {v}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadDetalle({ lead, onClose }: { lead: LeadWeb | null; onClose: () => void }) {
  const [notas, setNotas] = useState("");
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
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="pr-6">{lead.negocio}</DialogTitle>
          <DialogDescription>
            {lead.nombre} · aplicó {fechaHora(lead.created_at)} · {NOMBRE_ESTADO[lead.estado]}
          </DialogDescription>
        </DialogHeader>
        {lead.dudoso && (
          <p className="flex items-center gap-2 rounded-xl border border-orange-500/50 bg-orange-500/10 p-3 text-sm font-medium text-orange-700 dark:text-orange-300">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Revisar: dice que invierte más de $700.000 pero factura menos de $10M por mes.
          </p>
        )}
        <DatosLead lead={lead} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Mover a</span>
          <select value={lead.estado} onChange={(e) => void mover(lead, e.target.value as Estado)} className="h-10 w-full rounded-lg border bg-background px-2 text-sm">
            {(Object.keys(NOMBRE_ESTADO) as Estado[]).map((e) => (
              <option key={e} value={e}>
                {NOMBRE_ESTADO[e]}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-2">
          <p className="text-sm font-medium">Notas</p>
          <Textarea rows={4} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Cómo fue la reunión, qué propuesta le mandaste…" />
          <Button onClick={() => void guardar()} disabled={guardando || notas === (lead.notas ?? "")} size="sm">
            {guardando ? "Guardando…" : "Guardar notas"}
          </Button>
        </div>
        {(lead.historial?.length ?? 0) > 0 && (
          <details className="rounded-xl border px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">Historial</summary>
            <ol className="mt-2 space-y-1">
              {[...(lead.historial ?? [])].reverse().map((h, i) => (
                <li key={i}>
                  <span className="font-medium">{NOMBRE_ESTADO[h.a as Estado] ?? h.a}</span>
                  {h.por_nombre ? ` · ${h.por_nombre}` : ""} · <span className="text-muted-foreground">{fechaHora(h.at)}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </DialogContent>
    </Dialog>
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
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-sm rounded-2xl">
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
