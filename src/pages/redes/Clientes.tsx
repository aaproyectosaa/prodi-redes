import { useEffect, useMemo, useState } from "react";
import { ElegirServicios } from "@/components/redes/ServiciosCliente";
import { servicioInfo, serviciosDe, type IdServicio } from "@/lib/redes/servicios";
import { avisar } from "@/lib/redes/avisos";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { addDoc, collection, doc, getDoc } from "@/lib/db";
import { Building2, ChevronRight, Copy, Loader2, Mail, Plus, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/redes/api";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db } from "@/integrations/firebase/client";
import { assertEditable } from "@/lib/redes/vistaComo";
import { PageShell } from "@/components/redes/PageShell";
import { cn } from "@/lib/utils";
import { PlanUsage } from "@/components/redes/PlanUsage";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { LogoCliente } from "@/components/redes/LogoCliente";
import { QuienSubeDialog } from "@/components/redes/QuienSubeDialog";
import { ClientesViejos } from "@/components/redes/admin/HistorialFacturas";
import { formatARS, hoyISO, mesActual } from "@/lib/redes/format";
import { planDe, usoPlan } from "@/lib/redes/planes";
import { useFacturas } from "@/lib/redes/facturacion";
import { calcularRiesgo } from "@/lib/redes/riesgo";
import { sumarMeses } from "@/lib/fecha";

/** Dirección de la app para el mensaje de bienvenida (VITE_APP_URL o la de esta pestaña). */
const urlApp = () => (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, "");
/** Sin acentos ni mayúsculas, para buscar "gulala" y encontrar "GULALÁ". */
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Campos suaves (mismo estilo que Reuniones y Pedir video). */
const SUAVE =
  "rounded-2xl border-transparent bg-muted/60 shadow-none transition-colors focus-visible:border-primary focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0 focus:ring-4 focus:ring-primary/15 focus:ring-offset-0";
const ETIQUETA = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

const COLORES = ["#6F40FC", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#84CC16", "#F97316", "#3B82F6", "#A855F7"];

export default function Clientes() {
  const navigate = useNavigate();
  const { clientes, planes, videos } = useRedes();
  const { profiles } = useAppData();
  const { role } = useUserProfileContext();
  const [nuevo, setNuevo] = useState(false);
  // Alta desde un lead ganado del CRM (/clientes?lead=ID): viene con sus datos y, si lo trajo un socio, queda con él.
  const [params, setParams] = useSearchParams();
  const [desdeLead, setDesdeLead] = useState<LeadAlta | null>(null);
  useEffect(() => {
    const id = params.get("lead");
    if (!id || role !== "admin") return;
    void getDoc(doc(db, "leads_web", id)).then((s) => {
      const d = s.data() as { negocio?: string; nombre?: string; email?: string; socio_nombre?: string | null; cliente_id?: string | null } | undefined;
      if (!d) return toast.error("No encontramos ese lead");
      if (d.cliente_id) return toast.info("Ese lead ya se dio de alta como cliente");
      setDesdeLead({ id, negocio: d.negocio ?? "", nombre: d.nombre ?? "", email: d.email ?? "", socio: d.socio_nombre ?? null });
      setNuevo(true);
    });
  }, [params, role]);
  const cerrarNuevo = (v: boolean) => {
    setNuevo(v);
    if (!v && desdeLead) {
      setDesdeLead(null);
      params.delete("lead");
      setParams(params, { replace: true });
    }
  };
  const [busqueda, setBusqueda] = useState("");
  const [quienSube, setQuienSube] = useState(false);
  const mes = mesActual();
  // Busca por nombre, rubro, Instagram o quién del equipo lo lleva.
  const visibles = useMemo(() => {
    const q = normal(busqueda);
    if (!q) return clientes;
    const nombreDe = (id: string) => profiles.find((p) => p.id === id)?.nombre ?? "";
    return clientes.filter((c) => {
      const equipo = Object.values(c.team_roles ?? {}).flat().map(nombreDe);
      return normal([c.nombre, c.marca?.rubro, c.redes?.instagram, ...equipo].filter(Boolean).join(" ")).includes(q);
    });
  }, [busqueda, clientes, profiles]);
  const isAdmin = role === "admin";
  // Riesgo de que se vaya (solo lo ve el super admin: usa boletas y accesos).
  const { facturas } = useFacturas(sumarMeses(mes, -11), isAdmin);
  const riesgos = useMemo(
    () => (isAdmin ? calcularRiesgo({ clientes, videos, planes, profiles, facturas }) : null),
    [isAdmin, clientes, videos, planes, profiles, facturas]
  );

  return (
    <PageShell
      title={<span className="text-[26px] font-bold tracking-tight">Clientes</span>}
      subtitle={clientes.length === 1 ? "1 cliente activo" : `${clientes.length} clientes activos`}
      actions={
        isAdmin && (
          <>
            <Button variant="outline" onClick={() => setQuienSube(true)} className="h-11 rounded-2xl px-4 font-semibold">
              <Upload className="mr-2 h-4 w-4" /> Quién sube
            </Button>
            <Button onClick={() => setNuevo(true)} className="h-11 rounded-2xl px-5 font-semibold shadow-lg shadow-primary/25">
              <Plus className="mr-2 h-4 w-4" /> Nuevo cliente
            </Button>
          </>
        )
      }
    >
      {clientes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-muted/60 px-6 py-14 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-background text-primary shadow-sm">
            <Building2 className="h-7 w-7" />
          </span>
          <p className="text-base font-semibold">Sin clientes</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Creá el primero para empezar a planificar videos.</p>
          {isAdmin && (
            <Button onClick={() => setNuevo(true)} className="mt-5 h-11 rounded-2xl px-5 font-semibold shadow-lg shadow-primary/25">
              <Plus className="mr-2 h-4 w-4" /> Nuevo cliente
            </Button>
          )}
        </div>
      ) : (
        <>
        <div className="relative mb-5 max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setBusqueda("")}
            placeholder="Buscar cliente, rubro o persona del equipo…"
            aria-label="Buscar cliente"
            className={cn(SUAVE, "h-12 pl-11 pr-10 text-[15px]")}
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              aria-label="Borrar búsqueda"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {busqueda && visibles.length > 0 && (
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">
            {visibles.length === 1 ? "1 resultado" : `${visibles.length} resultados`}
          </p>
        )}
        {visibles.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-muted/60 px-6 py-12 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-muted-foreground shadow-sm">
              <Search className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">No hay clientes que coincidan con «{busqueda}».</p>
            <button type="button" onClick={() => setBusqueda("")} className="mt-2 text-sm font-medium text-primary underline-offset-2 hover:underline">
              Borrar búsqueda
            </button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((c) => {
            const plan = planDe(c, planes);
            const uso = usoPlan(c, planes, videos, mes);
            const equipoIds = Array.from(
              new Set([...(c.team_roles?.productor ?? []), ...(c.team_roles?.editor ?? []), ...(c.team_roles?.pauta ?? []), ...(c.team_roles?.diseno ?? [])])
            );
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/clientes/${c.id}`)}
                className="group flex flex-col rounded-2xl border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 sm:p-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <LogoCliente cliente={c} className="h-12 w-12 rounded-2xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold leading-tight">{c.nombre}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex max-w-full items-center truncate rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {plan.nombre}
                      </span>
                      {isAdmin && plan.precioMensual > 0 && (
                        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{formatARS(plan.precioMensual)}</span>
                      )}
                      {serviciosDe(c).map((sv) => {
                        const info = servicioInfo(sv.id);
                        return (
                          <span
                            key={sv.id}
                            title={`${info.nombre} · ${sv.estado === "activo" ? "activo" : "en desarrollo"}`}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                          >
                            <info.icon className="h-3 w-3" /> {info.nombre}
                          </span>
                        );
                      })}
                      {c.produccion?.publica === "cliente" && (
                        <span className="inline-flex items-center rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          Sube el cliente
                        </span>
                      )}
                      {(() => {
                        const r = riesgos?.get(c.id);
                        if (!r || r.nivel === "ok") return null;
                        const alto = r.nivel === "alto";
                        return (
                          <span
                            title={r.motivos.map((m) => `• ${m.texto}`).join("\n")}
                            aria-label={`Riesgo ${r.nivel}: ${r.motivos.map((m) => m.texto).join(", ")}`}
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              alto ? "bg-destructive/12 text-destructive" : "bg-warning/15 text-warning"
                            )}
                          >
                            Riesgo {r.nivel}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                <PlanUsage uso={uso} compact className="mt-4" />
                <div className="mt-4 flex items-center justify-between gap-2">
                  <div className="flex -space-x-2">
                    {equipoIds.map((id) => {
                      const p = profiles.find((x) => x.id === id);
                      return p ? <UserAvatar key={id} profile={p} size="sm" className="h-7 w-7 ring-2 ring-card" /> : null;
                    })}
                    {equipoIds.length === 0 && <span className="text-xs text-muted-foreground">Sin equipo asignado</span>}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </button>
            );
          })}
        </div>
        </>
      )}
      {isAdmin && <ClientesViejos />}
      <NuevoClienteDialog open={nuevo} onOpenChange={cerrarNuevo} lead={desdeLead} />
      {isAdmin && <QuienSubeDialog open={quienSube} onOpenChange={setQuienSube} clientes={clientes} />}
    </PageShell>
  );
}

interface Alta {
  nombre: string;
  usuario: string | null;
  email: string | null;
  password: string | null;
  pid: string;
  /** Ya tenía usuario (dueño de varias empresas): se lo sumó a esta. */
  yaTenia?: boolean;
}

/** El lead ganado del CRM del que sale el cliente (y el socio comercial que lo trajo, si hay). */
interface LeadAlta {
  id: string;
  negocio: string;
  nombre: string;
  email: string;
  socio: string | null;
}

/** Alta de cliente en un solo paso: marca, plan, equipo, su usuario y el mensaje de bienvenida listo. */
function NuevoClienteDialog({ open, onOpenChange, lead }: { open: boolean; onOpenChange: (v: boolean) => void; lead?: LeadAlta | null }) {
  const navigate = useNavigate();
  const { planes } = useRedes();
  const { profiles } = useAppData();
  const [nombre, setNombre] = useState("");
  const [planId, setPlanId] = useState<string>("");
  const [color, setColor] = useState(COLORES[0]);
  const [equipo, setEquipo] = useState<Record<"productor" | "editor" | "pauta", string>>({ productor: "", editor: "", pauta: "" });
  const [contacto, setContacto] = useState({ nombre: "", email: "" });
  const [tipo, setTipo] = useState<"boleta" | "factura">("boleta");
  const [servicios, setServicios] = useState<IdServicio[]>([]);
  const [saving, setSaving] = useState(false);
  const [alta, setAlta] = useState<Alta | null>(null);
  useEffect(() => {
    if (!lead || !open) return;
    setNombre(lead.negocio);
    setContacto({ nombre: lead.nombre, email: lead.email });
  }, [lead, open]);

  const reset = () => {
    setNombre("");
    setPlanId("");
    setColor(COLORES[0]);
    setEquipo({ productor: "", editor: "", pauta: "" });
    setContacto({ nombre: "", email: "" });
    setTipo("boleta");
    setServicios([]);
    setAlta(null);
  };
  const cerrar = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };
  const de = (rol: string) => profiles.filter((p) => p.role === rol && p.activo !== false);
  const emailOk = !contacto.email.trim() || /.+@.+\..+/.test(contacto.email.trim());

  const save = async () => {
    if (!nombre.trim() || !emailOk) return;
    setSaving(true);
    try {
      assertEditable();
      const email = contacto.email.trim().toLowerCase();
      // Mismo dueño de varias empresas: si ese mail ya es de un usuario cliente, se lo suma a esta (no se crea otro).
      const existente = email ? profiles.find((p) => (p.email ?? "").toLowerCase() === email) : undefined;
      if (existente && existente.role !== "cliente") {
        toast.error("Ese mail es de alguien del equipo. Usá el mail del cliente.");
        return;
      }
      const ref = await addDoc(collection(db, "projects"), {
        nombre: nombre.trim(),
        color,
        enabled: true,
        plan_redes_id: planId || null,
        team_roles: {
          productor: equipo.productor ? [equipo.productor] : [],
          editor: equipo.editor ? [equipo.editor] : [],
          pauta: equipo.pauta ? [equipo.pauta] : [],
          cliente: existente ? [existente.id] : [],
        },
        contacto_emails: email ? [email] : [],
        facturacion: { tipo },
        servicios: servicios.map((id) => ({ id, estado: "desarrollo", desde: hoyISO() })),
        alta: hoyISO(),
        created_at: new Date().toISOString(),
      });
      // Salió de un lead: queda con el socio que lo trajo y la fecha de alta (y el lead, ganado y con su cliente).
      if (lead)
        await callApi("/api/web/socio-alta", { lead_id: lead.id, proyecto_id: ref.id }).catch((e) =>
          toast.error(`El cliente se creó, pero no se enganchó con el lead: ${e instanceof Error ? e.message : "error"}`)
        );
      let password: string | null = null;
      if (email && !existente) {
        try {
          const r = await callApi<{ uid: string; password: string }>("/api/usuarios/crear", {
            nombre: contacto.nombre.trim() || nombre.trim(),
            email,
            rol: "cliente",
            clientes: [ref.id],
          });
          password = r.password;
        } catch (e) {
          toast.error(`El cliente se creó, pero no su usuario: ${e instanceof Error ? e.message : "error"}`);
        }
      }
      // Ya tenía usuario: la empresa le aparece sola en su panel (sin volver a entrar); le avisamos.
      if (existente)
        void avisar({
          destinatarios: [existente.id],
          titulo: `Sumamos ${nombre.trim()} a tu panel`,
          cuerpo: "Ya la tenés en el selector de empresas, arriba de tu panel.",
          link: "/cliente",
          clave: `empresa-nueva:${ref.id}`,
          proyectoId: ref.id,
        });
      setAlta({ nombre: nombre.trim(), usuario: contacto.nombre.trim() || existente?.nombre || null, email: email || null, password, pid: ref.id, yaTenia: !!existente });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear");
    } finally {
      setSaving(false);
    }
  };

  if (alta) {
    const mensaje = mensajeBienvenida(alta, planes.find((p) => p.id === planId));
    return (
      <Dialog open={open} onOpenChange={cerrar}>
        <DialogContent className="max-w-lg overflow-y-auto sm:max-h-[94dvh] sm:rounded-2xl">
          <DialogHeader className="space-y-3 text-left">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/25">
              <Building2 className="h-5 w-5" />
            </span>
            <DialogTitle className="text-[22px] font-bold tracking-tight">¡{alta.nombre} ya está adentro! 🎉</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {alta.yaTenia
              ? "Ya tenía usuario: lo sumamos a esta empresa. Entra con el mismo mail y contraseña y cambia de empresa con el selector de arriba. Mandale este mensaje:"
              : alta.password
                ? "Le creamos su usuario. Mandale este mensaje de bienvenida:"
                : "Mandale este mensaje de bienvenida (cuando le crees el usuario, sumale sus datos de acceso):"}
          </p>
          <Textarea readOnly rows={11} value={mensaje} className={cn(SUAVE, "text-sm leading-relaxed")} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-2xl font-semibold"
              onClick={() => void navigator.clipboard?.writeText(mensaje).then(() => toast.success("Mensaje copiado"), () => toast.error("No se pudo copiar"))}
            >
              <Copy className="mr-1.5 h-4 w-4" /> Copiar
            </Button>
            {alta.email && (
              <Button variant="outline" asChild className="h-11 rounded-2xl font-semibold">
                <a href={`mailto:${alta.email}?subject=${encodeURIComponent("Bienvenidos a Prodi")}&body=${encodeURIComponent(mensaje)}`}>
                  <Mail className="mr-1.5 h-4 w-4" /> Mandar por mail
                </a>
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button
              className="h-12 rounded-2xl px-6 font-semibold shadow-lg shadow-primary/25"
              onClick={() => {
                const pid = alta.pid;
                cerrar(false);
                navigate(`/clientes/${pid}?tab=config`);
              }}
            >
              Ir al cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent className="max-w-lg overflow-y-auto sm:max-h-[94dvh] sm:rounded-2xl">
        <DialogHeader className="space-y-3 text-left">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <DialogTitle className="text-[22px] font-bold tracking-tight">Nuevo cliente</DialogTitle>
          {lead && (
            <p className="w-fit rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Viene del CRM{lead.socio ? ` · traído por ${lead.socio}` : ""}
            </p>
          )}
            <p className="text-sm text-muted-foreground">Marca, plan, equipo y su usuario en un solo paso.</p>
          </div>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-3">
            <p className={ETIQUETA}>La marca</p>
            <div className="space-y-1.5">
              <Label htmlFor="nc-nombre">Nombre</Label>
              <Input id="nc-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la marca" autoFocus className={cn(SUAVE, "h-12 text-[15px] font-medium")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={planId} onValueChange={setPlanId}>
                  <SelectTrigger className={cn(SUAVE, "h-12")}>
                    <SelectValue placeholder="Elegí un plan" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {planes.filter((p) => p.activo).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nombre} · {formatARS(p.precio_mensual)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!planes.some((p) => p.activo) && (
                  <p className="text-xs text-muted-foreground">
                    Todavía no hay planes. Crealos en{" "}
                    <Link to="/ajustes" className="font-medium text-primary underline-offset-2 hover:underline">
                      Ajustes
                    </Link>{" "}
                    (ej. 4, 8 y 12 videos por mes).
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Se le hace</Label>
                <Select value={tipo} onValueChange={(v) => setTipo(v as "boleta" | "factura")}>
                  <SelectTrigger className={cn(SUAVE, "h-12")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="boleta">Boleta</SelectItem>
                    <SelectItem value="factura">Factura (con IVA)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 rounded-2xl bg-muted/60 p-3">
              {COLORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn("h-8 w-8 rounded-full ring-offset-2 ring-offset-muted transition-transform hover:scale-110", color === c && "scale-110 ring-2 ring-foreground")}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className={ETIQUETA}>Qué más contrató</p>
              <p className="text-xs text-muted-foreground">Además de Redes. Cada uno le suma un módulo a su panel (después se edita desde su ficha).</p>
            </div>
            <ElegirServicios valor={servicios} onChange={setServicios} />
          </div>

          <div className="space-y-3">
            <p className={ETIQUETA}>Quién lo lleva</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["productor", "Producción"],
                  ["editor", "Edición"],
                  ["pauta", "Pauta"],
                ] as const
              ).map(([rol, label]) => (
                <div key={rol} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Select value={equipo[rol] || "_"} onValueChange={(v) => setEquipo((e) => ({ ...e, [rol]: v === "_" ? "" : v }))}>
                    <SelectTrigger className={cn(SUAVE, "h-12")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="_">Después</SelectItem>
                      {de(rol).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className={ETIQUETA}>El contacto del cliente</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nc-contacto">Nombre</Label>
                <Input id="nc-contacto" value={contacto.nombre} onChange={(e) => setContacto((c) => ({ ...c, nombre: e.target.value }))} placeholder="Ej.: Martín Gómez" className={cn(SUAVE, "h-12")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nc-mail">Mail</Label>
                <Input id="nc-mail" type="email" value={contacto.email} onChange={(e) => setContacto((c) => ({ ...c, email: e.target.value }))} placeholder="Con este mail entra a su panel y le llegan las boletas" className={cn(SUAVE, "h-12", !emailOk && "border-destructive focus-visible:border-destructive")} />
                {!emailOk && <p className="text-xs text-destructive">Revisá el mail</p>}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => cerrar(false)} className="h-12 rounded-2xl font-semibold">
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !nombre.trim() || !emailOk} className="h-12 rounded-2xl px-6 font-semibold shadow-lg shadow-primary/25">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Dar de alta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function mensajeBienvenida(a: Alta, plan?: { nombre: string; videos_mes: number; piezas_mes?: number }) {
  const hola = a.usuario ? `¡Hola ${a.usuario.split(" ")[0]}!` : "¡Hola!";
  const url = urlApp();
  return [
    `${hola} Bienvenidos a Prodi 🙌`,
    "",
    `Ya está listo el panel de ${a.nombre}. Ahí vas a ver tus videos, aprobarlos, pedir piezas gráficas, seguir los resultados y tus boletas.`,
    plan ? `${/^plan\b/i.test(plan.nombre.trim()) ? `Tu ${plan.nombre}` : `Tu plan ${plan.nombre}`} incluye ${plan.videos_mes} videos con publicidad${plan.piezas_mes ? ` y ${plan.piezas_mes} piezas gráficas` : ""} por mes.` : "",
    "",
    `Entrá acá: ${url}`,
    a.yaTenia
      ? `Entrás con el mismo usuario de siempre (${a.email}) y cambiás de empresa con el selector de arriba del panel.`
      : a.email
        ? `Usuario: ${a.email}`
        : "",
    a.password ? `Contraseña: ${a.password} (la podés cambiar desde tu perfil)` : "",
    "",
    "Lo primero: subí tu logo y los colores de tu marca, y contanos qué vendés en “Mi negocio”. Con eso arrancamos.",
    "",
    "Cualquier cosa, escribinos por el chat del panel o por acá. ¡Vamos con todo!",
  ]
    .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
    .join("\n");
}

export { COLORES };
