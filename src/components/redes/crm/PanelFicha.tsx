import { useEffect, useMemo, useState } from "react";
import {
  AtSign,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Copy,
  Facebook,
  Instagram,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Store,
  StickyNote,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  anotarContacto,
  asignarContacto,
  borrarContacto,
  editarContacto,
  ETAPAS,
  linkCanal,
  moverContacto,
  sumarDiasCrm,
  videosParaElegir,
  type ContactoCrm,
  type EtapaCrm,
  type VendedorCrm,
} from "@/lib/redes/crm";
import { cn } from "@/lib/utils";
import { useRedes } from "@/contexts/redes-data-context";

// La ficha de un contacto (lado derecho), igual que la de Leads: etapa, datos, quién lo atiende, notas, próximo paso,
// registrar lo que pasó y la actividad.

const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const plata = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
const hace = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return m <= 1 ? "recién" : `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
};
const fechaLinda = (f: string | null | undefined) => {
  if (!f) return "Sin fecha";
  const hoy = hoyAR();
  if (f === hoy) return "Hoy";
  if (f < hoy) return "Atrasado";
  if (f === sumarDiasCrm(hoy, 1)) return "Mañana";
  return new Date(`${f}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
};

/** Título chico de cada parte. */
function Titulo({ children, accion }: { children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
      {accion}
    </div>
  );
}

/** Etapa: botones con su color (en vez de un desplegable). */
function SelectorEtapa({ c, onVendido }: { c: ContactoCrm; onVendido: () => void }) {
  return (
    <div className="grid grid-cols-5 gap-1 rounded-xl bg-muted/70 p-1">
      {ETAPAS.map((e) => {
        const activa = c.etapa === e.k;
        return (
          <button
            key={e.k}
            type="button"
            onClick={() => (e.k === "vendido" ? onVendido() : void moverContacto(c, e.k as EtapaCrm))}
            title={e.ayuda}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-[background-color,box-shadow,color] duration-100 active:scale-95",
              activa ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className={cn("h-1.5 w-6 rounded-full", activa ? e.punto : "bg-muted-foreground/25")} />
            <span className="truncate">{e.label}</span>
          </button>
        );
      })}
    </div>
  );
}

type Campo = "telefono" | "instagram" | "facebook" | "email";
const CAMPOS: { k: Campo; label: string; icono: React.ElementType; placeholder: string }[] = [
  { k: "telefono", label: "WhatsApp", icono: Phone, placeholder: "Ej.: 3492 123456" },
  { k: "instagram", label: "Instagram", icono: Instagram, placeholder: "@usuario" },
  { k: "facebook", label: "Facebook", icono: Facebook, placeholder: "usuario o link del perfil" },
  { k: "email", label: "Email", icono: AtSign, placeholder: "nombre@mail.com" },
];

/** Sus datos: botones para contactarlo, lo cargado (se toca el lápiz para cambiarlo) y lo que falta. */
function Datos({ c }: { c: ContactoCrm }) {
  const [editando, setEditando] = useState<Campo | null>(null);
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const abrir = (k: Campo) => {
    setEditando(k);
    setValor(c[k] ?? "");
  };
  const guardar = async () => {
    if (!editando) return;
    setGuardando(true);
    try {
      await editarContacto(c, { [editando]: valor.trim() || null });
      setEditando(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  const presentes = CAMPOS.filter((f) => c[f.k] || editando === f.k);
  const faltan = CAMPOS.filter((f) => !c[f.k] && editando !== f.k);
  const acciones = [
    c.telefono && { label: "WhatsApp", icono: MessageCircle, href: linkCanal(c, "whatsapp"), clase: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300" },
    c.telefono && { label: "Llamar", icono: Phone, href: `tel:${c.telefono.replace(/[^\d+]/g, "")}` },
    c.instagram && { label: "Instagram", icono: Instagram, href: linkCanal(c, "instagram") },
    c.facebook && { label: "Facebook", icono: Facebook, href: linkCanal(c, "facebook") },
    c.email && {
      label: "Copiar mail",
      icono: Copy,
      onClick: () => void navigator.clipboard?.writeText(c.email!).then(() => toast.success("Mail copiado")),
    },
  ].filter(Boolean) as { label: string; icono: React.ElementType; href?: string; onClick?: () => void; clase?: string }[];

  return (
    <div className="space-y-3">
      {acciones.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {acciones.map((a) => {
            const clase = cn(
              "flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors",
              a.clase || "bg-card text-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            );
            const I = a.icono;
            return a.href ? (
              <a key={a.label} href={a.href} target={a.href.startsWith("tel:") ? undefined : "_blank"} rel="noopener noreferrer" className={clase}>
                <I className="h-3.5 w-3.5" /> {a.label}
              </a>
            ) : (
              <button key={a.label} type="button" onClick={a.onClick} className={clase}>
                <I className="h-3.5 w-3.5" /> {a.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {presentes.map(({ k, label, icono: I, placeholder }) =>
          editando === k ? (
            <div key={k} className="col-span-2 flex items-start gap-2 rounded-xl border border-primary/50 bg-primary/[0.04] p-2">
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
              <Button size="sm" className="h-9 rounded-lg" onClick={() => void guardar()} disabled={guardando}>
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setEditando(null)} aria-label="Cancelar">
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div key={k} className={cn("group relative min-w-0 rounded-xl border bg-card px-3 py-2", (k === "email" || String(c[k]).length > 22) && "col-span-2")}>
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <I className="h-3 w-3" /> {label}
              </p>
              <p className="mt-0.5 truncate pr-6 text-sm font-medium" title={String(c[k])}>
                {c[k]}
              </p>
              <button
                type="button"
                onClick={() => abrir(k)}
                className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground md:opacity-0 [@media(hover:none)]:md:opacity-100 md:group-hover:opacity-100"
                aria-label={`Cambiar ${label}`}
                title={`Cambiar ${label.toLowerCase()}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        )}
      </div>

      {faltan.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Falta:</span>
          {faltan.map(({ k, label, icono: I }) => (
            <button
              key={k}
              type="button"
              onClick={() => abrir(k)}
              className="flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="h-3 w-3" />
              <I className="h-3 w-3" /> {label}
            </button>
          ))}
        </div>
      )}

      <VideoQueLoTrajo c={c} />

      {c.interes && (
        <div className="rounded-xl bg-muted/50 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lo que pidió</p>
          <p className="mt-0.5 whitespace-pre-wrap text-xs font-medium">{c.interes}</p>
        </div>
      )}
    </div>
  );
}

/** El video de Prodi que trajo al contacto (para saber qué video vende). */
function VideoQueLoTrajo({ c }: { c: ContactoCrm }) {
  const { videos } = useRedes();
  const [eligiendo, setEligiendo] = useState(false);
  const paraElegir = videosParaElegir(videos, c.proyecto_id);
  const actual = videos.find((v) => v.id === c.video_id);
  if (c.origen !== "anuncio" && !c.video_id) return null;
  if (!paraElegir.length && !actual) return null;
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Clapperboard className="h-3 w-3" /> Lo trajo el video
        </p>
        <button type="button" onClick={() => setEligiendo(!eligiendo)} className="text-[11px] font-medium text-primary hover:underline">
          {eligiendo ? "Listo" : actual ? "Cambiar" : "Elegir"}
        </button>
      </div>
      {!eligiendo ? (
        <p className={cn("mt-0.5 truncate text-sm font-medium", !actual && "text-muted-foreground/70")}>{actual?.titulo ?? "Sin elegir: así no sabés qué video te vendió"}</p>
      ) : (
        <div className="mt-1.5 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {[{ id: null as string | null, titulo: "No sé" }, ...paraElegir].map((v) => (
            <button
              key={v.id ?? "nose"}
              type="button"
              onClick={() => {
                void editarContacto(c, { video_id: v.id });
                setEligiendo(false);
              }}
              className={cn("rounded-full border px-3 py-1 text-xs", (c.video_id ?? null) === v.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {v.titulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ICONO_TIPO: Record<string, React.ElementType> = { llamada: Phone, mio: MessageCircle, suyo: MessageCircle, email: Mail, visita: Store, nota: StickyNote, paso: CalendarClock };
const COLOR_TIPO: Record<string, string> = {
  mio: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  suyo: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  llamada: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  visita: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  email: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  paso: "bg-primary/15 text-primary",
  nota: "bg-muted text-muted-foreground",
};
const PREFIJO: Record<string, string> = { mio: "Le escribiste: ", suyo: "Respondió: ", llamada: "Llamaste", visita: "Vino al local", email: "Le mandaste un mail" };

export function PanelFicha({ c, vendedores, onCerrar }: { c: ContactoCrm; vendedores: VendedorCrm[]; onCerrar: () => void }) {
  const [vendiendo, setVendiendo] = useState(false);
  const [monto, setMonto] = useState(c.monto_venta ? String(c.monto_venta) : "");
  const [notas, setNotas] = useState(c.notas ?? "");
  const [guardandoNotas, setGuardandoNotas] = useState(false);
  const [paso, setPaso] = useState(c.proximo_texto ?? "");
  const [fecha, setFecha] = useState<string | null>(c.proximo ?? sumarDiasCrm(hoyAR(), 1));
  const [editandoPaso, setEditandoPaso] = useState(false);
  const [guardandoPaso, setGuardandoPaso] = useState(false);
  const [registro, setRegistro] = useState<null | "llamada" | "visita" | "email" | "nota">(null);
  const [textoRegistro, setTextoRegistro] = useState("");
  const [verTodo, setVerTodo] = useState(false);

  useEffect(() => {
    setVendiendo(false);
    setMonto(c.monto_venta ? String(c.monto_venta) : "");
    setRegistro(null);
    setEditandoPaso(false);
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setNotas(c.notas ?? ""), [c.id, c.notas]);
  useEffect(() => {
    setPaso(c.proximo_texto ?? "");
    setFecha(c.proximo ?? sumarDiasCrm(hoyAR(), 1));
  }, [c.id, c.proximo, c.proximo_texto]);

  const abierto = c.etapa !== "vendido" && c.etapa !== "perdido";
  const hoy = hoyAR();
  const pasoVencido = !!c.proximo && c.proximo < hoy;
  const pasoHoy = c.proximo === hoy;
  const mostrarFormPaso = !c.proximo || editandoPaso;
  const rapidas = [
    { label: "Hoy", f: hoy },
    { label: "Mañana", f: sumarDiasCrm(hoy, 1) },
    { label: "En 3 días", f: sumarDiasCrm(hoy, 3) },
    { label: "En una semana", f: sumarDiasCrm(hoy, 7) },
  ];
  const historial = useMemo(() => [...(c.historial ?? [])].reverse(), [c.historial]);
  const visibles = verTodo ? historial : historial.slice(0, 5);

  const vender = async () => {
    try {
      await moverContacto(c, "vendido", { monto: Number(monto) || null });
      toast.success("¡Venta anotada!");
      setVendiendo(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    }
  };
  const guardarNotas = async () => {
    setGuardandoNotas(true);
    try {
      await editarContacto(c, { notas: notas.trim() || null });
      toast.success("Notas guardadas");
    } finally {
      setGuardandoNotas(false);
    }
  };
  const guardarPaso = async (borrar = false) => {
    setGuardandoPaso(true);
    try {
      await editarContacto(c, borrar ? { proximo: null, proximo_texto: null } : { proximo: fecha, proximo_texto: paso.trim() || null });
      toast.success(borrar ? "Próximo paso sacado" : "Próximo paso guardado");
      setEditandoPaso(false);
    } finally {
      setGuardandoPaso(false);
    }
  };
  const hecho = async () => {
    await anotarContacto(c, `Hecho: ${c.proximo_texto || "volver a escribirle"}`);
    await editarContacto(c, { proximo: null, proximo_texto: null });
    toast.success("¡Listo! Poné el siguiente paso");
  };
  const guardarRegistro = async () => {
    if (!registro) return;
    const t = textoRegistro.trim();
    await anotarContacto(c, registro === "nota" ? t : `${PREFIJO[registro]}${t ? `: ${t}` : ""}`, registro);
    toast.success("Anotado en la actividad");
    setRegistro(null);
    setTextoRegistro("");
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <Titulo>Etapa</Titulo>
        <SelectorEtapa c={c} onVendido={() => setVendiendo(true)} />
        {(vendiendo || c.etapa === "vendido") && (
          <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.06] p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> {c.etapa === "vendido" ? `Vendido${c.monto_venta ? ` por ${plata(c.monto_venta)}` : ""}` : "¿Cuánto le vendiste?"}
            </p>
            <div className="flex gap-2">
              <Input value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))} placeholder="Ej.: 18000" inputMode="numeric" className="h-9 bg-background" autoFocus={vendiendo} />
              <Button size="sm" className="h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={() => void vender()}>
                {c.etapa === "vendido" ? "Corregir" : "Anotar venta"}
              </Button>
              {vendiendo && c.etapa !== "vendido" && (
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setVendiendo(false)} aria-label="Cancelar">
                  <XCircle className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <Titulo>Datos</Titulo>
        <Datos c={c} />
      </section>

      {vendedores.length > 0 && (
        <section className="space-y-2">
          <Titulo>Lo atiende</Titulo>
          <div className="flex flex-wrap gap-1.5">
            {[{ id: null as string | null, nombre: "Nadie" }, ...vendedores.filter((v) => v.activo || v.id === c.vendedor_id)].map((v) => (
              <button
                key={v.id ?? "nadie"}
                type="button"
                onClick={() => void asignarContacto(c, vendedores.find((x) => x.id === v.id) ?? null)}
                className={cn(
                  "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                  (c.vendedor_id ?? null) === v.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                {v.nombre}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <Titulo
          accion={
            notas !== (c.notas ?? "") && (
              <Button onClick={() => void guardarNotas()} disabled={guardandoNotas} size="sm" className="h-7 rounded-full px-3 text-xs">
                {guardandoNotas ? "Guardando…" : "Guardar"}
              </Button>
            )
          }
        >
          Notas
        </Titulo>
        <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Lo que no está en el chat: qué busca, cuánto quiere gastar, cómo siguió…" className="min-h-[64px] rounded-xl" />
      </section>

      {/* Próximo paso */}
      {abierto && (
        <section className="space-y-2">
          <Titulo>Próximo paso</Titulo>
          {!mostrarFormPaso ? (
            <div className={cn("flex items-center gap-3 rounded-xl border p-3", pasoVencido ? "border-red-500/40 bg-red-500/5" : pasoHoy ? "border-amber-500/40 bg-amber-500/5" : "bg-card")}>
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", pasoVencido ? "bg-red-500 text-white" : pasoHoy ? "bg-amber-500 text-white" : "bg-primary/10 text-primary")}>
                <CalendarClock className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.proximo_texto || "Volver a escribirle"}</p>
                <p className={cn("text-[11px]", pasoVencido ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground")}>{fechaLinda(c.proximo)}</p>
              </div>
              <Button size="sm" className="h-8 rounded-full bg-emerald-500 px-3 text-xs text-white hover:bg-emerald-600" onClick={() => void hecho()} title="Marcar como hecho">
                <Check className="mr-1 h-3.5 w-3.5" /> Hecho
              </Button>
              <button type="button" onClick={() => setEditandoPaso(true)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Cambiar" aria-label="Cambiar">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border bg-card p-2.5">
              <Input
                value={paso}
                onChange={(e) => setPaso(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void guardarPaso()}
                placeholder="¿Qué sigue? Ej.: pasarle el precio del combo"
                maxLength={200}
                className="h-9 border-0 bg-muted/50 focus-visible:ring-1"
              />
              <div className="flex flex-wrap items-center gap-1">
                {rapidas.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => setFecha(r.f)}
                    className={cn("h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors", fecha === r.f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                  >
                    {r.label}
                  </button>
                ))}
                <input type="date" value={fecha ?? ""} onChange={(e) => setFecha(e.target.value || null)} className="h-7 rounded-full border bg-background px-2 text-[11px]" aria-label="Otra fecha" />
                <div className="ml-auto flex items-center gap-1">
                  {c.proximo && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void guardarPaso(true)} disabled={guardandoPaso} title="Sacar el próximo paso">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setEditandoPaso(false)}>
                        Cancelar
                      </Button>
                    </>
                  )}
                  <Button size="sm" className="h-7 rounded-full px-3 text-[11px]" onClick={() => void guardarPaso()} disabled={guardandoPaso || !fecha}>
                    {guardandoPaso ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Registrar lo que pasó */}
      <section className="space-y-2">
        <Titulo>Registrar</Titulo>
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              ["llamada", "Llamé", Phone],
              ["visita", "Vino", Store],
              ["email", "Mail", Mail],
              ["nota", "Nota", StickyNote],
            ] as const
          ).map(([t, label, I]) => (
            <button
              key={t}
              type="button"
              onClick={() => setRegistro(registro === t ? null : t)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-medium transition-colors",
                registro === t ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              <I className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {registro && (
          <div className="flex items-end gap-2 rounded-xl border bg-card p-2">
            <Textarea
              autoFocus
              rows={2}
              value={textoRegistro}
              onChange={(e) => setTextoRegistro(e.target.value)}
              placeholder={registro === "llamada" ? "¿Qué hablaron?" : registro === "visita" ? "¿Qué llevó o qué preguntó?" : registro === "email" ? "¿Qué le mandaste?" : "Escribí la nota"}
              className="min-h-[56px] resize-none border-0 bg-muted/50 text-sm focus-visible:ring-1"
            />
            <div className="flex flex-col gap-1">
              <Button size="sm" className="h-8 rounded-full px-3 text-xs" onClick={() => void guardarRegistro()} disabled={registro === "nota" && !textoRegistro.trim()}>
                Anotar
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setRegistro(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Línea de tiempo */}
      {historial.length > 0 && (
        <section className="space-y-2">
          <Titulo>Actividad</Titulo>
          <ol className="relative space-y-0.5">
            {visibles.map((h, i) => {
              const tipo = h.tipo ?? "paso";
              const I = ICONO_TIPO[tipo] ?? CalendarClock;
              const texto = tipo === "mio" || tipo === "suyo" ? `${PREFIJO[tipo]}${h.texto}` : h.texto;
              return (
                <li key={i} className="relative flex gap-2.5 pb-2.5">
                  {i < visibles.length - 1 && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-border" />}
                  <span className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", COLOR_TIPO[tipo] ?? COLOR_TIPO.nota)}>
                    <I className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-snug">{texto}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{hace(h.at)}</p>
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

      <button
        type="button"
        onClick={() => window.confirm(`¿Borrar a ${c.nombre}?`) && void borrarContacto(c).then(onCerrar)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" /> Borrar contacto
      </button>
    </div>
  );
}
