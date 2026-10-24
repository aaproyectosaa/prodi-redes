import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { CalendarCheck, Check, Copy, FileText, HandCoins, Loader2, MonitorPlay, Plus, Share2, Sparkles, Trophy, UserRoundPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { callApi } from "@/lib/redes/api";
import { enModoVista } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";
import { DemoPortalCliente } from "@/components/redes/socio/DemoPortalCliente";
import { usePoppins } from "@/components/redes/socio/usePoppins";

// Panel del socio comercial: su link (con QR) para compartir, cargar un empresario que entrevistó, cómo vienen sus
// empresarios y una demo del portal del cliente para mostrarles. No ve nada más del sistema.

interface LeadSocio {
  id: string;
  negocio: string;
  nombre: string;
  rubro: string;
  estado: string;
  created_at: string;
  updated_at: string;
  por_link: boolean;
}
interface Panel {
  codigo: string | null;
  link: string | null;
  leads: LeadSocio[];
}

const ESTADOS: Record<string, { label: string; icono: React.ElementType; clase: string }> = {
  calificado: { label: "Calificado", icono: Sparkles, clase: "bg-[#6F40FC]/12 text-[#6F40FC] dark:text-[#a98bff]" },
  no_califica: { label: "No califica", icono: XCircle, clase: "bg-muted text-muted-foreground" },
  reunion_agendada: { label: "Reunión", icono: CalendarCheck, clase: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  propuesta: { label: "Propuesta", icono: FileText, clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  ganado: { label: "Ganado", icono: Trophy, clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  perdido: { label: "Perdido", icono: XCircle, clase: "bg-red-500/10 text-red-600 dark:text-red-400" },
};
const fecha = (iso: string) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "");

export default function Socio() {
  usePoppins();
  const { profile } = useUserProfileContext();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargar, setCargar] = useState(false);
  const [demo, setDemo] = useState(false);

  const traer = () =>
    callApi<Panel>("/api/web/socio-panel", {})
      .then((p) => {
        setPanel(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar"));
  useEffect(() => {
    void traer();
  }, []);

  const nombre = (profile?.nombre ?? "").split(" ")[0];
  const leads = panel?.leads ?? [];
  const ganados = leads.filter((l) => l.estado === "ganado").length;
  const enCurso = leads.filter((l) => ["calificado", "reunion_agendada", "propuesta"].includes(l.estado)).length;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-28 pt-5 font-[Poppins,Inter,sans-serif] md:pb-10">
      <header className="space-y-1">
        <p className="text-sm font-medium text-[#6F40FC] dark:text-[#a98bff]">Socio comercial · Prodi</p>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">Hola{nombre ? `, ${nombre}` : ""} 👋</h1>
        <p className="text-sm text-muted-foreground">Compartí tu link o cargá a los empresarios que entrevistás.</p>
      </header>

      {error && <p className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {/* Números. */}
      <div className="grid grid-cols-3 gap-2.5">
        <Numero valor={leads.length} label="Empresarios" />
        <Numero valor={enCurso} label="En curso" />
        <Numero valor={ganados} label="Clientes" destacado />
      </div>

      <TuLink link={panel?.link ?? null} cargando={!panel && !error} />

      <div className="grid grid-cols-2 gap-2.5">
        <Button onClick={() => setCargar(true)} className="h-auto flex-col gap-1.5 rounded-2xl bg-[#6F40FC] py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#6F40FC]/30 hover:bg-[#5d32e6]">
          <UserRoundPlus className="h-5 w-5" /> Cargar empresario
        </Button>
        <Button variant="outline" onClick={() => setDemo(true)} className="h-auto flex-col gap-1.5 rounded-2xl py-3.5 text-sm font-semibold">
          <MonitorPlay className="h-5 w-5" /> Mostrar demo
        </Button>
      </div>

      {/* Sus empresarios. */}
      <section className="space-y-2.5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Tus empresarios</h2>
          <Link to="/mis-ganancias" className="inline-flex items-center gap-1 text-sm font-medium text-[#6F40FC] dark:text-[#a98bff]">
            <HandCoins className="h-4 w-4" /> Mis ganancias
          </Link>
        </div>
        {!panel && !error ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <div className="rounded-3xl border border-dashed p-8 text-center">
            <p className="font-semibold">Todavía no trajiste a nadie</p>
            <p className="mt-1 text-sm text-muted-foreground">Compartí tu link o cargá al primero que entrevistes.</p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-3xl border bg-card">
            {leads.map((l) => {
              const e = ESTADOS[l.estado] ?? ESTADOS.calificado;
              return (
                <li key={l.id} className="flex items-center gap-3 border-b px-4 py-3.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.negocio}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[l.nombre, l.rubro].filter(Boolean).join(" · ") || "—"} · {l.por_link ? "por tu link" : "cargado"} el {fecha(l.created_at)}
                    </p>
                  </div>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", e.clase)}>
                    <e.icono className="h-3 w-3" /> {e.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CargarEmpresario open={cargar} onOpenChange={setCargar} onListo={() => void traer()} />
      <DemoPortalCliente open={demo} onOpenChange={setDemo} />
    </div>
  );
}

function Numero({ valor, label, destacado }: { valor: number; label: string; destacado?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-3 text-center", destacado ? "border-[#6F40FC]/30 bg-[#6F40FC]/8" : "bg-card")}>
      <p className={cn("text-2xl font-bold tabular-nums", destacado && "text-[#6F40FC] dark:text-[#a98bff]")}>{valor}</p>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

/** Su link para compartir: copiar, compartir (WhatsApp, etc.) y el QR para mostrar en la entrevista. */
function TuLink({ link, cargando }: { link: string | null; cargando: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!link) return setQr(null);
    void QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: "#0a0a0a", light: "#ffffff" } }).then(setQr, () => setQr(null));
  }, [link]);
  const copiar = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  const compartir = async () => {
    if (!link) return;
    const texto = `Conocé cómo Prodi te arma los videos y la publicidad de tu empresa: ${link}`;
    if (navigator.share) await navigator.share({ title: "Prodi", text: texto, url: link }).catch(() => undefined);
    else window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  };
  return (
    <section className="relative overflow-hidden rounded-3xl bg-[#0a0a0a] p-5 text-white shadow-xl">
      <span className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#6F40FC]/50 blur-3xl" aria-hidden />
      <div className="relative space-y-4">
        <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/60">Tu link</p>
          {cargando ? (
            <Loader2 className="h-5 w-5 animate-spin text-white/60" />
          ) : link ? (
            <p className="break-all text-[15px] font-semibold leading-snug">{link.replace(/^https?:\/\//, "")}</p>
          ) : (
            <p className="text-sm text-white/70">Todavía no tenés código. Pedíselo a Prodi.</p>
          )}
        </div>
        {qr && <img src={qr} alt="QR de tu link" className="h-24 w-24 shrink-0 rounded-2xl bg-white p-1.5 sm:h-28 sm:w-28" />}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void copiar()} disabled={!link} className="h-11 rounded-full bg-white text-[#0a0a0a] hover:bg-white/90">
            {copiado ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />} {copiado ? "Copiado" : "Copiar"}
          </Button>
          <Button onClick={() => void compartir()} disabled={!link} className="h-11 rounded-full bg-[#6F40FC] text-white hover:bg-[#5d32e6]">
            <Share2 className="mr-1.5 h-4 w-4" /> Compartir
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Cargar a mano un empresario que entrevistó: entra al CRM de Prodi marcado como suyo. */
function CargarEmpresario({ open, onOpenChange, onListo }: { open: boolean; onOpenChange: (v: boolean) => void; onListo: () => void }) {
  const vacio = { nombre: "", negocio: "", rubro: "", telefono: "", nota: "" };
  const [d, setD] = useState(vacio);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (open) setD(vacio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ok = d.nombre.trim().length >= 2 && d.negocio.trim().length >= 2 && d.telefono.replace(/\D/g, "").length >= 8;
  const guardar = async () => {
    if (enModoVista()) return toast.info("Estás mirando como otra persona: no se carga nada.");
    setGuardando(true);
    try {
      const r = await callApi<{ id?: string; repetido?: boolean; tuyo?: boolean }>("/api/web/socio-cargar", d);
      if (r.repetido) toast.info(r.tuyo ? "Ese empresario ya lo tenías cargado." : "Ese empresario ya estaba en Prodi: queda para quien lo trajo primero.");
      else toast.success("¡Listo! Ya está en Prodi. Te avisamos cómo avanza.");
      onOpenChange(false);
      onListo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setGuardando(false);
    }
  };
  const campo = (k: keyof typeof vacio, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`ce-${k}`} className="text-xs font-semibold">{label}</Label>
      <Input id={`ce-${k}`} value={d[k]} onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} className="h-12 rounded-2xl text-[15px]" {...props} />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-3xl font-[Poppins,Inter,sans-serif]">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl">Cargar empresario</DialogTitle>
          <DialogDescription>Entra a Prodi como tuyo. Te avisamos cuando avance.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {campo("nombre", "Nombre", { placeholder: "Ej: Carlos Gómez", autoFocus: true })}
          {campo("negocio", "Empresa", { placeholder: "Ej: Gómez Materiales" })}
          <div className="grid grid-cols-2 gap-3">
            {campo("rubro", "Rubro", { placeholder: "Ej: Corralón" })}
            {campo("telefono", "Teléfono", { placeholder: "3482 123456", inputMode: "tel", type: "tel" })}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ce-nota" className="text-xs font-semibold">Nota de la entrevista</Label>
            <Textarea id="ce-nota" rows={3} value={d.nota} onChange={(e) => setD((x) => ({ ...x, nota: e.target.value }))} placeholder="Qué le interesa, cuándo llamarlo…" className="rounded-2xl text-[15px]" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void guardar()} disabled={!ok || guardando} className="h-12 w-full rounded-2xl bg-[#6F40FC] text-[15px] font-semibold text-white hover:bg-[#5d32e6]">
            {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Cargar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Para otras pantallas: el estado de un lead del socio con su color. */
export const estadoSocio = (e: string) => ESTADOS[e] ?? ESTADOS.calificado;
export const useEstadosSocio = () => useMemo(() => ESTADOS, []);
