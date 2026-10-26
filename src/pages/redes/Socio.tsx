import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { CalendarCheck, Check, ChevronDown, Copy, FileText, Loader2, MonitorPlay, Plus, QrCode, Share2, Sparkles, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { callApi } from "@/lib/redes/api";
import { formatARS } from "@/lib/redes/format";
import { enModoVista } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";
import { DemoPortalCliente } from "@/components/redes/socio/DemoPortalCliente";
import { usePoppins } from "@/components/redes/socio/usePoppins";

// Panel del vendedor (socio comercial). Simple: una línea con cómo le va, un botón grande para pasar un cliente,
// la demo para mostrar y sus clientes. El link con QR queda abajo, para el que lo quiera usar.

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
  ganado: number;
  comision: { comision_pct: number; meses: number; modo?: "mensual" | "entrada" } | null;
}

const ESTADOS: Record<string, { label: string; icono: React.ElementType; clase: string }> = {
  calificado: { label: "Lo estamos llamando", icono: Sparkles, clase: "bg-[#6F40FC]/12 text-[#6F40FC] dark:text-[#a98bff]" },
  no_califica: { label: "No encaja", icono: XCircle, clase: "bg-muted text-muted-foreground" },
  reunion_agendada: { label: "Reunión", icono: CalendarCheck, clase: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  propuesta: { label: "Le mandamos propuesta", icono: FileText, clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  ganado: { label: "¡Es cliente!", icono: Trophy, clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  perdido: { label: "No se dio", icono: XCircle, clase: "bg-red-500/10 text-red-600 dark:text-red-400" },
};
const fecha = (iso: string) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "");

export default function Socio() {
  usePoppins();
  const { profile } = useUserProfileContext();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasar, setPasar] = useState(false);
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
  const clientes = leads.filter((l) => l.estado === "ganado").length;

  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-4 pb-28 pt-5 font-[Poppins,Inter,sans-serif] md:pb-10">
      <header>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">Hola{nombre ? `, ${nombre}` : ""} 👋</h1>
        {/* Cómo le va, en una línea. */}
        {panel ? (
          <p className="mt-1 text-[15px] text-muted-foreground">
            Me pasaste <b className="text-foreground">{leads.length}</b> · <b className="text-foreground">{clientes}</b> {clientes === 1 ? "ya es cliente" : "ya son clientes"} ·{" "}
            <Link to="/mis-ganancias" className="font-semibold text-[#6F40FC] underline-offset-2 hover:underline dark:text-[#a98bff]">
              ganaste {formatARS(panel.ganado)}
            </Link>
          </p>
        ) : (
          !error && <Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </header>

      {error && <p className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {/* Lo principal: pasar un cliente. */}
      <button
        type="button"
        onClick={() => setPasar(true)}
        className="flex w-full items-center gap-4 rounded-3xl bg-[#6F40FC] p-5 text-left text-white shadow-xl shadow-[#6F40FC]/30 transition-transform active:scale-[0.98]"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20">
          <Plus className="h-7 w-7" />
        </span>
        <span>
          <span className="block text-xl font-bold">Pasame un cliente</span>
          <span className="block text-sm text-white/80">
            Nombre, empresa y teléfono. {panel?.comision
              ? panel.comision.modo === "entrada"
                ? `Si se hace cliente, ganás el ${panel.comision.comision_pct}% de su primer mes.`
                : `Si se hace cliente, ganás el ${panel.comision.comision_pct}% cada mes.`
              : "Nosotros lo llamamos."}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => setDemo(true)}
        className="flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-[#6F40FC]/40"
      >
        <MonitorPlay className="h-5 w-5 shrink-0 text-[#6F40FC]" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Mostrar la demo</span>
          <span className="block text-xs text-muted-foreground">Cómo el cliente aprueba sus videos y ve sus resultados</span>
        </span>
      </button>

      {/* Sus clientes. */}
      <section className="space-y-2.5">
        <h2 className="text-lg font-bold">Los que me pasaste</h2>
        {!panel && !error ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <p className="rounded-3xl border border-dashed p-6 text-center text-sm text-muted-foreground">Todavía ninguno. Tocá «Pasame un cliente» y arrancamos.</p>
        ) : (
          <ul className="overflow-hidden rounded-3xl border bg-card">
            {leads.map((l) => {
              const e = ESTADOS[l.estado] ?? ESTADOS.calificado;
              return (
                <li key={l.id} className="flex items-center gap-3 border-b px-4 py-3.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.negocio}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {l.nombre || "—"} · {fecha(l.created_at)}
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

      {/* El link con QR: para el que lo quiera usar (queda abajo, plegado). */}
      <TuLink link={panel?.link ?? null} />

      <PasarCliente open={pasar} onOpenChange={setPasar} onListo={() => void traer()} />
      <DemoPortalCliente open={demo} onOpenChange={setDemo} />
    </div>
  );
}

/** Su link para compartir (copiar, compartir y QR), plegado al final. */
function TuLink({ link }: { link: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!link || !abierto) return;
    void QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: "#0a0a0a", light: "#ffffff" } }).then(setQr, () => setQr(null));
  }, [link, abierto]);
  if (!link) return null;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  const compartir = async () => {
    const texto = `Conocé cómo Prodi te arma los videos y la publicidad de tu empresa: ${link}`;
    if (navigator.share) await navigator.share({ title: "Prodi", text: texto, url: link }).catch(() => undefined);
    else window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  };
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <button type="button" onClick={() => setAbierto(!abierto)} className="flex w-full items-center gap-3 p-4 text-left">
        <QrCode className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Mi link y QR</span>
          <span className="block text-xs text-muted-foreground">Si alguien entra por acá y deja sus datos, queda como tuyo</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
      </button>
      {abierto && (
        <div className="space-y-3 border-t p-4">
          <div className="flex items-center gap-4">
            <p className="min-w-0 flex-1 break-all text-sm font-semibold">{link.replace(/^https?:\/\//, "")}</p>
            {qr && <img src={qr} alt="QR de tu link" className="h-24 w-24 shrink-0 rounded-xl border bg-white p-1" />}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => void copiar()} className="h-11 rounded-full">
              {copiado ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />} {copiado ? "Copiado" : "Copiar"}
            </Button>
            <Button onClick={() => void compartir()} className="h-11 rounded-full bg-[#6F40FC] text-white hover:bg-[#5d32e6]">
              <Share2 className="mr-1.5 h-4 w-4" /> Compartir
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Pasar un cliente: nombre, empresa y teléfono (la nota es opcional). Entra al CRM de Prodi como suyo. */
function PasarCliente({ open, onOpenChange, onListo }: { open: boolean; onOpenChange: (v: boolean) => void; onListo: () => void }) {
  const vacio = { nombre: "", negocio: "", telefono: "", nota: "" };
  const [d, setD] = useState(vacio);
  const [conNota, setConNota] = useState(false);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (open) {
      setD(vacio);
      setConNota(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ok = d.nombre.trim().length >= 2 && d.negocio.trim().length >= 2 && d.telefono.replace(/\D/g, "").length >= 8;
  const guardar = async () => {
    if (enModoVista()) return toast.info("Estás mirando como otra persona: no se carga nada.");
    setGuardando(true);
    try {
      const r = await callApi<{ id?: string; repetido?: boolean; tuyo?: boolean }>("/api/web/socio-cargar", d);
      if (r.repetido) toast.info(r.tuyo ? "Ese ya me lo habías pasado." : "Ese ya estaba en Prodi: queda para quien lo pasó primero.");
      else toast.success("¡Gracias! Lo llamamos y te vamos contando.");
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
      <Label htmlFor={`pc-${k}`} className="text-xs font-semibold">{label}</Label>
      <Input id={`pc-${k}`} value={d[k]} onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} className="h-12 rounded-2xl text-[15px]" {...props} />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-3xl font-[Poppins,Inter,sans-serif]">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl">Pasame un cliente</DialogTitle>
          <DialogDescription>Nosotros lo llamamos y te avisamos cómo avanza.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {campo("nombre", "Nombre", { placeholder: "Ej: Carlos Gómez", autoFocus: true })}
          {campo("negocio", "Empresa", { placeholder: "Ej: Gómez Materiales" })}
          {campo("telefono", "Teléfono", { placeholder: "3482 123456", inputMode: "tel", type: "tel" })}
          {conNota ? (
            <Textarea rows={3} value={d.nota} onChange={(e) => setD((x) => ({ ...x, nota: e.target.value }))} placeholder="Qué le interesa, cuándo llamarlo…" className="rounded-2xl text-[15px]" autoFocus />
          ) : (
            <button type="button" onClick={() => setConNota(true)} className="text-sm font-medium text-[#6F40FC] dark:text-[#a98bff]">
              + Agregar una nota
            </button>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => void guardar()} disabled={!ok || guardando} className="h-12 w-full rounded-2xl bg-[#6F40FC] text-[15px] font-semibold text-white hover:bg-[#5d32e6]">
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Pasarlo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
