import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDoc, collection } from "@/lib/db";
import { Building2, Copy, Loader2, Mail, Plus, Search, Upload, X } from "lucide-react";
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
import { PageShell, EmptyState } from "@/components/redes/PageShell";
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

/** Dirección de la app para el mensaje de bienvenida (VITE_APP_URL o la de esta pestaña). */
const urlApp = () => (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, "");
/** Sin acentos ni mayúsculas, para buscar "gulala" y encontrar "GULALÁ". */
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const COLORES = ["#6F40FC", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#84CC16", "#F97316", "#3B82F6", "#A855F7"];

export default function Clientes() {
  const navigate = useNavigate();
  const { clientes, planes, videos } = useRedes();
  const { profiles } = useAppData();
  const { role } = useUserProfileContext();
  const [nuevo, setNuevo] = useState(false);
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

  return (
    <PageShell
      title="Clientes"
      subtitle={clientes.length === 1 ? "1 cliente activo" : `${clientes.length} clientes activos`}
      actions={
        isAdmin && (
          <>
            <Button variant="outline" onClick={() => setQuienSube(true)}>
              <Upload className="mr-2 h-4 w-4" /> Quién sube
            </Button>
            <Button onClick={() => setNuevo(true)}>
              <Plus className="mr-2 h-4 w-4" /> Nuevo cliente
            </Button>
          </>
        )
      }
    >
      {clientes.length === 0 ? (
        <EmptyState icon={Building2} title="Sin clientes" description="Creá el primero para empezar a planificar videos." />
      ) : (
        <>
        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setBusqueda("")}
            placeholder="Buscar cliente, rubro o persona del equipo…"
            aria-label="Buscar cliente"
            className="h-10 pl-9 pr-9"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
              aria-label="Borrar búsqueda"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {visibles.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No hay clientes que coincidan con «{busqueda}».</p>}
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
                className="rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <LogoCliente cliente={c} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {plan.nombre}
                        {isAdmin && plan.precioMensual > 0 && ` · ${formatARS(plan.precioMensual)}`}
                        {c.produccion?.publica === "cliente" && <span className="text-amber-600 dark:text-amber-400"> · Sube el cliente</span>}
                      </p>
                    </div>
                  </div>
                </div>
                <PlanUsage uso={uso} compact className="mt-4" />
                <div className="mt-4 flex -space-x-2">
                  {equipoIds.map((id) => {
                    const p = profiles.find((x) => x.id === id);
                    return p ? <UserAvatar key={id} profile={p} size="sm" className="ring-2 ring-card" /> : null;
                  })}
                  {equipoIds.length === 0 && <span className="text-xs text-muted-foreground">Sin equipo asignado</span>}
                </div>
              </button>
            );
          })}
        </div>
        </>
      )}
      {isAdmin && <ClientesViejos />}
      <NuevoClienteDialog open={nuevo} onOpenChange={setNuevo} />
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
}

/** Alta de cliente en un solo paso: marca, plan, equipo, su usuario y el mensaje de bienvenida listo. */
function NuevoClienteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { planes } = useRedes();
  const { profiles } = useAppData();
  const [nombre, setNombre] = useState("");
  const [planId, setPlanId] = useState<string>("");
  const [color, setColor] = useState(COLORES[0]);
  const [equipo, setEquipo] = useState<Record<"productor" | "editor" | "pauta", string>>({ productor: "", editor: "", pauta: "" });
  const [contacto, setContacto] = useState({ nombre: "", email: "" });
  const [tipo, setTipo] = useState<"boleta" | "factura">("boleta");
  const [saving, setSaving] = useState(false);
  const [alta, setAlta] = useState<Alta | null>(null);

  const reset = () => {
    setNombre("");
    setPlanId("");
    setColor(COLORES[0]);
    setEquipo({ productor: "", editor: "", pauta: "" });
    setContacto({ nombre: "", email: "" });
    setTipo("boleta");
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
      const ref = await addDoc(collection(db, "projects"), {
        nombre: nombre.trim(),
        color,
        enabled: true,
        plan_redes_id: planId || null,
        team_roles: {
          productor: equipo.productor ? [equipo.productor] : [],
          editor: equipo.editor ? [equipo.editor] : [],
          pauta: equipo.pauta ? [equipo.pauta] : [],
          cliente: [],
        },
        contacto_emails: email ? [email] : [],
        facturacion: { tipo },
        alta: hoyISO(),
        created_at: new Date().toISOString(),
      });
      let password: string | null = null;
      if (email) {
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
      setAlta({ nombre: nombre.trim(), usuario: contacto.nombre.trim() || null, email: email || null, password, pid: ref.id });
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
        <DialogContent className="sm:max-h-[94dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>¡{alta.nombre} ya está adentro! 🎉</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {alta.password ? "Le creamos su usuario. Mandale este mensaje de bienvenida:" : "Mandale este mensaje de bienvenida (cuando le crees el usuario, sumale sus datos de acceso):"}
          </p>
          <Textarea readOnly rows={11} value={mensaje} className="text-sm" />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void navigator.clipboard?.writeText(mensaje).then(() => toast.success("Mensaje copiado"), () => toast.error("No se pudo copiar"))}
            >
              <Copy className="mr-1.5 h-4 w-4" /> Copiar
            </Button>
            {alta.email && (
              <Button variant="outline" asChild>
                <a href={`mailto:${alta.email}?subject=${encodeURIComponent("Bienvenidos a Prodi")}&body=${encodeURIComponent(mensaje)}`}>
                  <Mail className="mr-1.5 h-4 w-4" /> Mandar por mail
                </a>
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button
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
      <DialogContent className="sm:max-h-[94dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">La marca</p>
            <div className="space-y-1.5">
              <Label htmlFor="nc-nombre">Nombre</Label>
              <Input id="nc-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la marca" autoFocus />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={planId} onValueChange={setPlanId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí un plan" />
                  </SelectTrigger>
                  <SelectContent>
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boleta">Boleta</SelectItem>
                    <SelectItem value="factura">Factura (con IVA)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {COLORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-background ${color === c ? "ring-2 ring-foreground" : ""}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quién lo lleva</p>
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
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
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">El contacto del cliente</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nc-contacto">Nombre</Label>
                <Input id="nc-contacto" value={contacto.nombre} onChange={(e) => setContacto((c) => ({ ...c, nombre: e.target.value }))} placeholder="Ej.: Martín Gómez" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nc-mail">Mail</Label>
                <Input id="nc-mail" type="email" value={contacto.email} onChange={(e) => setContacto((c) => ({ ...c, email: e.target.value }))} placeholder="Con este mail entra a su panel y le llegan las boletas" />
                {!emailOk && <p className="text-xs text-destructive">Revisá el mail</p>}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => cerrar(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !nombre.trim() || !emailOk}>
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
    a.email ? `Usuario: ${a.email}` : "",
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
