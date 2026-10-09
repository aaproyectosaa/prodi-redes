import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { doc, updateDoc } from "@/lib/db";
import { ArrowLeft, Clapperboard, Eye, Loader2, Mail, MessageCircle, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputNumero } from "@/components/ui/input-numero";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell, Section, StatCard } from "@/components/redes/PageShell";
import { VideoCard } from "@/components/redes/VideoCard";
import { PlanUsage } from "@/components/redes/PlanUsage";
import { PlanificarDialog, type ModoPlanificar } from "@/components/redes/PlanificarDialog";
import { BotonArmarMes } from "@/components/redes/PlanesAviso";
import { ContextoComercialEditor } from "@/components/redes/ContextoComercial";
import { resumenMarca } from "@/lib/redes/proximoPaso";
import { ResultadosMes, resumirMes } from "@/components/redes/ResultadosMes";
import { EvolucionMensajes } from "@/components/redes/EvolucionMensajes";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { ETAPAS, quienFilma } from "@/lib/redes/etapas";
import { formatARS, mesActual, mesLabel, sumarMeses, fechaCorta } from "@/lib/redes/format";
import { planDe, REDES_PLAN, usoPlan } from "@/lib/redes/planes";
import { DIA_VENCIMIENTO, totalMensual } from "@/lib/redes/facturacion";
import { PlazoPago } from "@/components/redes/admin/PlazoPago";
import { HistorialFacturas } from "@/components/redes/admin/HistorialFacturas";
import { errorPlazo, plazoInicial, plazoParaGuardar } from "@/lib/redes/plazoPago";
import { callApi } from "@/lib/redes/api";
import { CONDICIONES_IVA, type CondicionIva, type Project, type ProjectTeamRole, type QuienFilma, type QuienPublica, type ServicioCliente } from "@/integrations/firebase/types";
import { COLORES } from "./Clientes";
import { MarcaArchivos } from "@/components/redes/MarcaArchivos";
import { ContactosCliente } from "@/components/redes/ContactosCliente";
import { LogoCliente } from "@/components/redes/LogoCliente";
import { DebitoAdmin } from "@/components/redes/Debito";
import { cn } from "@/lib/utils";
import { assertEditable } from "@/lib/redes/vistaComo";
import { chatClienteId } from "@/lib/redes/chat";
import { abrirEnDock } from "@/lib/redes/chatDock";

export default function ClienteDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "resumen";
  const { clienteById, videos, planes, cobros, settings, chats } = useRedes();
  const { role } = useUserProfileContext();
  const cliente = clienteById(id);
  const [mes, setMes] = useState(mesActual());
  const [planificar, setPlanificar] = useState<false | ModoPlanificar>(false);
  const isAdmin = role === "admin";

  if (!cliente) {
    return (
      <PageShell title="Cliente">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </PageShell>
    );
  }

  const plan = planDe(cliente, planes);
  const uso = usoPlan(cliente, planes, videos, mes);
  const delMes = videos.filter((v) => v.proyecto_id === cliente.id && v.mes === mes);
  const resumen = resumirMes(videos, cliente.id, mes);
  const misCobros = cobros.filter((c) => c.proyecto_id === cliente.id);

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };

  return (
    <PageShell
      title={
        <span className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button type="button" onClick={() => navigate("/clientes")} className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground" aria-label="Volver">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <LogoCliente cliente={cliente} className="h-9 w-9 text-xs sm:h-10 sm:w-10" />
          <span className="min-w-0 break-words">{cliente.nombre}</span>
        </span>
      }
      subtitle={`${plan.nombre} · ${plan.videosMes} videos/mes${isAdmin ? ` · ${formatARS(plan.precioMensual)}` : ""}`}
      actions={
        <>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 0, -1, -2, -3, -4, -5].map((d) => {
                const m = sumarMeses(mesActual(), d);
                return (
                  <SelectItem key={m} value={m}>
                    {mesLabel(m)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <BotonArmarMes clienteId={cliente.id} />
          {chats.some((c) => c.id === chatClienteId(cliente.id)) && (
            <Button
              variant="outline"
              onClick={() => {
                const id = chatClienteId(cliente.id);
                if (!abrirEnDock(id)) navigate(`/chat?c=${id}`);
              }}
            >
              <MessageCircle className="mr-2 h-4 w-4" /> Chat
            </Button>
          )}
          <Button variant="outline" onClick={() => setPlanificar("filmado")} title="Fuiste a grabar sin planificar: creás el video y subís el material">
            <Clapperboard className="mr-2 h-4 w-4" /> Ya lo filmé
          </Button>
          <Button onClick={() => setPlanificar("planificar")}>
            <Plus className="mr-2 h-4 w-4" /> Planificar
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6 flex h-auto w-full justify-start overflow-x-auto sm:inline-flex sm:w-auto">
          <TabsTrigger value="resumen">Videos</TabsTrigger>
          <TabsTrigger value="resultados">Resultados</TabsTrigger>
          <TabsTrigger value="comercial">Comercial</TabsTrigger>
          <TabsTrigger value="config">Configuración</TabsTrigger>
          {isAdmin && <TabsTrigger value="informe">Informe y cobros</TabsTrigger>}
        </TabsList>

        <TabsContent value="resumen" className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 sm:col-span-1">
              <PlanUsage uso={uso} />
            </div>
            <StatCard label="Publicados" value={`${uso.publicados}/${uso.cupo}`} />
            <StatCard label="Extras comprados" value={uso.creditosExtra} hint={mesLabel(mes)} />
          </div>
          {delMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay videos planificados para {mesLabel(mes).toLowerCase()}.</p>
          ) : (
            <div className="space-y-6">
              {ETAPAS.map((e) => {
                const items = delMes.filter((v) => v.etapa === e.value);
                if (!items.length) return null;
                return (
                  <Section key={e.value} title={`${e.label} (${items.length})`}>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((v) => (
                        <VideoCard key={v.id} video={v} showCliente={false} showEtapa={false} />
                      ))}
                    </div>
                  </Section>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resultados">
          <ResultadosMes resumen={resumen} grafico={<EvolucionMensajes videos={videos} proyectoId={cliente.id} mes={mes} />} />
        </TabsContent>

        <TabsContent value="comercial">
          <Section
            title="Contexto comercial para la IA"
            description="Lo que vende, qué cuenta como resultado y lo que está de temporada. La IA lo usa en el plan del mes, los textos, los guiones y las piezas."
          >
            <ContextoComercialEditor proyectoId={cliente.id} nombre={cliente.nombre} sugerido={resumenMarca(cliente)} />
          </Section>
        </TabsContent>

        <TabsContent value="config">
          <ConfigCliente cliente={cliente} isAdmin={isAdmin} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="informe" className="space-y-8">
            <InformeCliente cliente={cliente} mes={mes} />
            <Section title="Débito automático del abono" description="Mercado Pago cobra el abono todos los meses con la tarjeta del cliente.">
              {/* El débito cobra el total de la boleta (con IVA y extras fijos) más la comisión de MP de Ajustes. */}
              <DebitoAdmin
                cliente={cliente}
                monto={totalMensual({ abono: planDe(cliente, planes).precioMensual, facturacion: cliente.facturacion ?? null }, settings.iva_pct ?? 21)}
                comision={settings.comision_mp_pct}
              />
            </Section>
            <Section title="Cobros">
              {misCobros.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin cobros por Mercado Pago.</p>
              ) : (
                <div className="divide-y rounded-xl border bg-card">
                  {misCobros.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium">{c.concepto}</p>
                        <p className="text-xs text-muted-foreground">
                          {fechaCorta(c.created_at)} {c.mp_payment_id ? `· MP #${c.mp_payment_id}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{formatARS(c.monto)}</p>
                        <p className={cn("text-[11px] capitalize", c.estado === "aprobado" ? "text-success" : "text-muted-foreground")}>{c.estado}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
            <HistorialFacturas proyectoId={cliente.id} />
          </TabsContent>
        )}
      </Tabs>

      <PlanificarDialog open={!!planificar} onOpenChange={(v) => !v && setPlanificar(false)} modoInicial={planificar || "planificar"} clienteId={cliente.id} />
    </PageShell>
  );
}

const ROLES_EQUIPO: { rol: ProjectTeamRole; label: string; desc: string }[] = [
  { rol: "productor", label: "Producción", desc: "Planifica, filma y revisa" },
  { rol: "editor", label: "Edición", desc: "Edita los videos" },
  { rol: "pauta", label: "Pauta", desc: "Sube y pauta los videos" },
  { rol: "diseno", label: "Diseño", desc: "Arma las piezas gráficas: ve este cliente y le llegan sus pedidos" },
  { rol: "cliente", label: "Usuarios del cliente", desc: "Aprueban y ven resultados" },
];

const PUBLICA_OPCIONES: { v: QuienPublica; titulo: string; texto: string }[] = [
  { v: "prodi", titulo: "Los subimos nosotros", texto: "Cuando el cliente aprueba, el video pasa a pauta para subirlo y pautarlo." },
  { v: "cliente", titulo: "Los sube el cliente", texto: "Cuando aprueba, el video se le entrega para que lo descargue y lo suba él. No pasa por pauta." },
];

const FILMA_OPCIONES: { v: QuienFilma; titulo: string; texto: string }[] = [
  { v: "prodi", titulo: "Filmamos nosotros", texto: "Como siempre: se agenda el rodaje y producción sube el crudo." },
  { v: "cliente", titulo: "Filma el cliente", texto: "Todos sus videos los filma él y nos manda el material desde su panel." },
  { v: "ambos", titulo: "Los dos", texto: "En cada pedido elige quién lo filma, y puede mandarnos material extra para cualquier video." },
];

const SERVICIO_OPCIONES: { v: ServicioCliente; titulo: string; texto: string }[] = [
  { v: "completo", titulo: "Todo", texto: "Filmamos (o nos manda material), editamos, lo aprueba y lo pautamos." },
  { v: "solo_pauta", titulo: "Solo pauta", texto: "Nos manda los videos terminados y nosotros solo los subimos y pautamos. Sin rodaje ni edición." },
];

function ConfigCliente({ cliente, isAdmin }: { cliente: Project; isAdmin: boolean }) {
  const { planes, settings, clientes } = useRedes();
  const { profiles } = useAppData();
  const { role, user } = useUserProfileContext();
  const puedeFilma = isAdmin || (role === "productor" && !!user && (cliente.team_roles?.productor ?? []).includes(user.uid));
  const [form, setForm] = useState(() => toForm(cliente));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(toForm(cliente));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente.id]);

  const set = <K extends keyof ReturnType<typeof toForm>>(k: K, v: ReturnType<typeof toForm>[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  // "¿Qué le hacemos?" sin contradicciones: solo pauta → incluye pauta; si sube el cliente → no pautamos ni
  // administramos; si se activa pauta o administración → los subimos nosotros.
  const elegir = <K extends "servicio" | "publica" | "ovPauta" | "ovAdminRedes">(k: K, v: ReturnType<typeof toForm>[K]) =>
    setForm((f) => {
      const n = { ...f, [k]: v };
      if (k === "servicio" && v === "solo_pauta") n.ovPauta = true;
      if (k === "publica" && v === "cliente") Object.assign(n, { ovPauta: false, ovAdminRedes: false });
      if ((k === "ovPauta" || k === "ovAdminRedes") && v && n.publica === "cliente") n.publica = "prodi";
      return n;
    });

  const toggleTeam = (rol: ProjectTeamRole, uid: string) =>
    setForm((f) => {
      const cur = new Set(f.team[rol] ?? []);
      if (cur.has(uid)) cur.delete(uid);
      else cur.add(uid);
      return { ...f, team: { ...f.team, [rol]: Array.from(cur) } };
    });

  const save = async () => {
    setSaving(true);
    try {
      assertEditable();
      const errPlazo = isAdmin ? errorPlazo(form.factPagoDesde, form.factPagoHasta, settings.dia_vencimiento ?? DIA_VENCIMIENTO) : null;
      if (errPlazo) throw new Error(errPlazo);
      const emails = form.emails
        .split(/[,\s;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /.+@.+\..+/.test(e));
      const data: Record<string, unknown> = {
        // Colores y archivos de la marca se guardan aparte (MarcaArchivos): no se pisan con lo que había al abrir.
        marca: {
          ...(cliente.marca ?? {}),
          rubro: form.marca.rubro ?? "",
          publico: form.marca.publico ?? "",
          tono: form.marca.tono ?? "",
          tipografias: form.marca.tipografias ?? "",
          notas: form.marca.notas ?? "",
        },
        redes: form.redes,
        meta: form.meta,
      };
      // Quién filma: admin o la productora del cliente (reglas.ts). Solo se escribe si cambió.
      if (
        form.filma !== quienFilma(cliente) ||
        form.publica !== (cliente.produccion?.publica ?? "prodi") ||
        form.servicio !== (cliente.produccion?.servicio === "solo_pauta" ? "solo_pauta" : "completo")
      )
        // Solo pauta: lo publicamos siempre nosotros.
        data.produccion = { ...(cliente.produccion ?? {}), filma: form.filma, publica: form.servicio === "solo_pauta" ? "prodi" : form.publica, servicio: form.servicio };
      if (isAdmin) {
        // Ahí se mandan boletas e informes: solo lo cambia el admin.
        Object.assign(data, {
          contacto_emails: emails,
          nombre: form.nombre.trim() || cliente.nombre,
          color: form.color,
          enabled: form.enabled,
          plan_redes_id: form.planId || null,
          plan_redes_override: {
            videos_mes: form.ovVideos === "" ? null : Number(form.ovVideos),
            precio_mensual: form.ovPrecio === "" ? null : Number(form.ovPrecio),
            precio_video_extra: form.ovExtra === "" ? null : Number(form.ovExtra),
            piezas_mes: form.ovPiezas === "" ? null : Number(form.ovPiezas),
            precio_extra_tiktok: form.ovExtraTiktok === "" ? null : Number(form.ovExtraTiktok),
            precio_extra_youtube: form.ovExtraYoutube === "" ? null : Number(form.ovExtraYoutube),
            precio_extra_short: form.ovExtraShort === "" ? null : Number(form.ovExtraShort),
            duracion_extra: Object.fromEntries(Object.entries(form.ovDuracion).map(([k, v]) => [k, v === "" ? null : Number(v)])),
            redes: form.ovRedes,
            pauta: { incluida: form.ovPauta || form.servicio === "solo_pauta", monto: (form.ovPauta || form.servicio === "solo_pauta") && form.ovPautaMonto !== "" ? Number(form.ovPautaMonto) : null },
            administracion_redes: form.ovAdminRedes,
          },
          facturacion: {
            // Lo que se maneja desde Cobros (pausada, recordatorios) no se pierde.
            ...(cliente.facturacion ?? {}),
            tipo: form.factTipo,
            razon_social: form.factRazon.trim() || null,
            cuit: form.factCuit.trim() || null,
            condicion_iva: form.factCondIva || null,
            adelantado_hasta: /^\d{4}-\d{2}$/.test(form.factAdelantado) ? form.factAdelantado : null,
            ...plazoParaGuardar(form.factPagoDesde, form.factPagoHasta, settings.dia_vencimiento ?? DIA_VENCIMIENTO),
            modo_cobro: form.factModo,
            extras_fijos: form.factFijos
              .filter((x) => x.concepto.trim() && Number(x.neto) > 0)
              .map((x) => ({ concepto: x.concepto.trim(), neto: Number(x.neto) })),
          },
          team_roles: { ...(cliente.team_roles ?? {}), ...form.team },
        });
      }
      await updateDoc(doc(db, "projects", cliente.id), data);
      toast.success("Cliente guardado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  // Usuarios de cliente que ya son de otra empresa: no se ofrecen acá.
  const deOtroCliente = new Set(
    clientes.filter((c) => c.id !== cliente.id).flatMap((c) => c.team_roles?.cliente ?? [])
  );
  const candidatos = (rol: ProjectTeamRole) => {
    const asignados = form.team[rol] ?? [];
    return profiles
      .filter((p) => {
        // Lo que ya está tildado se sigue viendo (para poder sacarlo), aunque esté desactivado.
        if (asignados.includes(p.id)) return true;
        if (p.activo === false || p.role !== rol) return false;
        // Los super admin ya ven todo: no hace falta ofrecerlos en cada rol.
        return rol !== "cliente" || !deOtroCliente.has(p.id);
      })
      .sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? ""));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {isAdmin && (
        <Section title="Datos y plan">
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />
              </div>
              <label className="flex items-end gap-2 pb-2">
                <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
                <span className="text-sm">{form.enabled ? "Activo" : "Dado de baja"}</span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {COLORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set("color", c)}
                  className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-background ${form.color === c ? "ring-2 ring-foreground" : ""}`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={form.planId || "none"} onValueChange={(v) => set("planId", v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin plan</SelectItem>
                  {planes.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre} · {p.videos_mes} videos · {formatARS(p.precio_mensual)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Ajustes solo para este cliente (vacío = usa el plan)</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Piezas/mes</Label>
                  <InputNumero value={form.ovPiezas} onChange={(e) => set("ovPiezas", e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Videos/mes</Label>
                  <InputNumero value={form.ovVideos} onChange={(e) => set("ovVideos", e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Abono $</Label>
                  <InputNumero value={form.ovPrecio} onChange={(e) => set("ovPrecio", e.target.value.replace(/\D/g, ""))} />
                </div>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Video extra según para dónde es: precio y hasta cuántos minutos dura (vacío = el mismo precio que Instagram)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Instagram/FB $</Label>
                  <InputNumero value={form.ovExtra} onChange={(e) => set("ovExtra", e.target.value.replace(/\D/g, ""))} />
                  <div className="flex items-center gap-1.5">
                    <InputNumero decimales className="h-8 w-14 shrink-0 text-center text-xs" value={form.ovDuracion.meta} onChange={(e) => set("ovDuracion", { ...form.ovDuracion, meta: e.target.value })} placeholder="—" aria-label="Minutos" />
                    <span className="text-[11px] text-muted-foreground">min máx</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">TikTok $</Label>
                  <InputNumero value={form.ovExtraTiktok} onChange={(e) => set("ovExtraTiktok", e.target.value.replace(/\D/g, ""))} placeholder={form.ovExtra ? "igual" : ""} />
                  <div className="flex items-center gap-1.5">
                    <InputNumero decimales className="h-8 w-14 shrink-0 text-center text-xs" value={form.ovDuracion.tiktok} onChange={(e) => set("ovDuracion", { ...form.ovDuracion, tiktok: e.target.value })} placeholder="—" aria-label="Minutos" />
                    <span className="text-[11px] text-muted-foreground">min máx</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">YT Shorts $</Label>
                  <InputNumero value={form.ovExtraShort} onChange={(e) => set("ovExtraShort", e.target.value.replace(/\D/g, ""))} placeholder={form.ovExtra ? "igual" : ""} />
                  <div className="flex items-center gap-1.5">
                    <InputNumero decimales className="h-8 w-14 shrink-0 text-center text-xs" value={form.ovDuracion.short} onChange={(e) => set("ovDuracion", { ...form.ovDuracion, short: e.target.value })} placeholder="—" aria-label="Minutos" />
                    <span className="text-[11px] text-muted-foreground">min máx</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">YouTube $</Label>
                  <InputNumero value={form.ovExtraYoutube} onChange={(e) => set("ovExtraYoutube", e.target.value.replace(/\D/g, ""))} placeholder={form.ovExtra ? "igual" : ""} />
                  <div className="flex items-center gap-1.5">
                    <InputNumero decimales className="h-8 w-14 shrink-0 text-center text-xs" value={form.ovDuracion.youtube} onChange={(e) => set("ovDuracion", { ...form.ovDuracion, youtube: e.target.value })} placeholder="—" aria-label="Minutos" />
                    <span className="text-[11px] text-muted-foreground">min máx</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section title="¿Qué le hacemos?" description="Todo lo que hacemos para este cliente. Lo ve en «Mi plan» y define por dónde pasa cada video.">
        <div className="space-y-5 rounded-xl border bg-card p-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold">1. Videos</p>
            <Opciones opciones={SERVICIO_OPCIONES} valor={form.servicio} onElegir={(v) => elegir("servicio", v)} disabled={!puedeFilma} />
            {form.servicio === "solo_pauta" && (
              <p className="text-[11px] text-muted-foreground">
                El cliente pide el video desde su panel y sube el video terminado. Cuando toca «Listo», pasa directo a «Para subir y pautar» y le
                avisamos a pauta. Si el video lo cargan ustedes, en el video aparece «Enviar a pauta» en vez de «Enviar a edición».
              </p>
            )}
          </div>

          {/* Solo pauta: el material lo manda siempre el cliente y lo publicamos nosotros. */}
          {form.servicio !== "solo_pauta" && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">2. ¿Quién filma?</p>
              <Opciones opciones={FILMA_OPCIONES} valor={form.filma} onElegir={(v) => set("filma", v)} disabled={!puedeFilma} />
              <p className="text-[11px] text-muted-foreground">
                Los videos que filma el cliente no llevan rodaje: quedan en “Material del cliente” hasta que sube lo que grabó y avisa. Igual
                entran en el plan del mes (y si ya lo usó, se cobran como video extra).
              </p>
            </div>
          )}

          {form.servicio !== "solo_pauta" && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">3. ¿Quién los sube?</p>
              <Opciones opciones={PUBLICA_OPCIONES} valor={form.publica} onElegir={(v) => elegir("publica", v)} disabled={!puedeFilma} />
            </div>
          )}

          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-semibold">{form.servicio === "solo_pauta" ? "2" : "4"}. Además</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.ovPauta || form.servicio === "solo_pauta"} onCheckedChange={(v) => elegir("ovPauta", v)} disabled={!isAdmin || form.servicio === "solo_pauta"} /> Pauta
              </label>
              {(form.ovPauta || form.servicio === "solo_pauta") && isAdmin && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Inversión por mes $</span>
                  <InputNumero className="h-8 w-32" value={form.ovPautaMonto} onChange={(e) => set("ovPautaMonto", e.target.value.replace(/\D/g, ""))} placeholder="Ej: 100.000" />
                </div>
              )}
              {form.servicio === "solo_pauta" && <span className="text-[11px] text-muted-foreground">(siempre, es solo pauta)</span>}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Switch checked={form.ovAdminRedes} onCheckedChange={(v) => elegir("ovAdminRedes", v)} disabled={!isAdmin} className="mt-0.5" />
              <span>
                Administración de redes
                <span className="block text-xs text-muted-foreground">Publicamos y mantenemos el perfil. No incluye responder mensajes.</span>
              </span>
            </label>
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Redes en las que trabajamos</p>
              <div className="flex flex-wrap gap-2">
                {REDES_PLAN.map((r) => (
                  <button
                    key={r.k}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => set("ovRedes", { ...form.ovRedes, [r.k]: !form.ovRedes[r.k] })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                      form.ovRedes[r.k] ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    {form.ovRedes[r.k] ? "✓ " : ""}
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {form.publica === "cliente" && form.servicio !== "solo_pauta" && (
              <p className="text-[11px] text-muted-foreground">Como los sube el cliente, no pautamos ni administramos sus redes (si activás una de esas, pasa a «Los subimos nosotros»).</p>
            )}
            {!isAdmin && <p className="text-[11px] text-muted-foreground">Pauta, administración y redes las cambia el admin.</p>}
            {!puedeFilma && <p className="text-[11px] text-muted-foreground">Lo cambia el admin o la productora del cliente.</p>}
          </div>
        </div>
      </Section>

      {isAdmin && (
        <Section title="Facturación" description="Cómo se le arma la boleta el 27 y cuándo la paga.">
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1">
              {(["boleta", "factura"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("factTipo", t)}
                  className={cn("rounded-lg py-1.5 text-sm font-medium transition-all", form.factTipo === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground")}
                >
                  {t === "boleta" ? "Boleta (sin IVA)" : "Factura (con IVA)"}
                </button>
              ))}
            </div>
            <PlazoPago
              modo={form.factModo}
              onModo={(m) => set("factModo", m)}
              desde={form.factPagoDesde}
              hasta={form.factPagoHasta}
              onChange={(v) => setForm((f) => ({ ...f, factPagoDesde: v.desde, factPagoHasta: v.hasta }))}
              adelantado={form.factAdelantado}
              onAdelantado={(m) => set("factAdelantado", m)}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Razón social</Label>
                <Input value={form.factRazon} onChange={(e) => set("factRazon", e.target.value)} placeholder="Si es distinta del nombre" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CUIT</Label>
                <Input value={form.factCuit} onChange={(e) => set("factCuit", e.target.value)} placeholder="Opcional" />
              </div>
            </div>
            {form.factTipo === "factura" && (
              <div className="space-y-1">
                <Label className="text-xs">Condición frente al IVA</Label>
                <select
                  value={form.factCondIva}
                  onChange={(e) => set("factCondIva", e.target.value as CondicionIva | "")}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Elegí (define si la factura es A o B)</option>
                  {Object.entries(CONDICIONES_IVA).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Ítems que se suman todos los meses</Label>
              {form.factFijos.map((x, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={x.concepto}
                    onChange={(e) => set("factFijos", form.factFijos.map((y, j) => (j === i ? { ...y, concepto: e.target.value } : y)))}
                    placeholder="Ej.: Combustible"
                  />
                  <InputNumero
                    className="w-28"
                    value={x.neto}
                    onChange={(e) => set("factFijos", form.factFijos.map((y, j) => (j === i ? { ...y, neto: e.target.value.replace(/\D/g, "") } : y)))}
                    placeholder="$"
                  />
                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => set("factFijos", form.factFijos.filter((_, j) => j !== i))} aria-label="Quitar">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => set("factFijos", [...form.factFijos, { concepto: "", neto: "" }])}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Agregar ítem fijo
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Se guarda con el botón “Guardar” de abajo.</p>
          </div>
        </Section>
      )}

      {isAdmin && (
        <Section title="Equipo del cliente" description="Quién trabaja en esta cuenta. Los avisos llegan a estas personas.">
          <div className="space-y-4 rounded-xl border bg-card p-4">
            {ROLES_EQUIPO.map(({ rol, label, desc }) => (
              <div key={rol}>
                <p className="text-sm font-medium">{label}</p>
                <p className="mb-1.5 text-xs text-muted-foreground">{desc}</p>
                <div className="flex flex-wrap gap-2">
                  {candidatos(rol).map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs",
                        form.team[rol]?.includes(p.id) && "border-primary bg-primary/10"
                      )}
                    >
                      <Checkbox checked={form.team[rol]?.includes(p.id) ?? false} onCheckedChange={() => toggleTeam(rol, p.id)} className="h-3.5 w-3.5" />
                      {p.nombre}
                    </label>
                  ))}
                  {candidatos(rol).length === 0 && (
                    <span className="text-xs text-muted-foreground">No hay usuarios con este rol. Asignalo en Equipo.</span>
                  )}
                </div>
                {rol === "diseno" && !form.team.diseno?.length && candidatos(rol).length > 0 && (
                  <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                    Sin diseñadora asignada: por ahora lo ven todas y a todas les llegan sus pedidos.
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <ContactosCliente cliente={cliente} />

      <Section title="Marca" description="La IA usa esto para escribir copys y diseñar piezas.">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Rubro</Label>
              <Input value={form.marca.rubro ?? ""} onChange={(e) => set("marca", { ...form.marca, rubro: e.target.value })} placeholder="Ej: restaurante, concesionaria" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Público</Label>
            <Input value={form.marca.publico ?? ""} onChange={(e) => set("marca", { ...form.marca, publico: e.target.value })} placeholder="Ej: familias de Reconquista, 30-55 años" />
          </div>
          <div className="space-y-1.5">
            <Label>Tono</Label>
            <Input value={form.marca.tono ?? ""} onChange={(e) => set("marca", { ...form.marca, tono: e.target.value })} placeholder="Ej: cercano, con voseo, sin exagerar" />
          </div>
          <div className="space-y-1.5">
            <Label>Tipografías</Label>
            <Input value={form.marca.tipografias ?? ""} onChange={(e) => set("marca", { ...form.marca, tipografias: e.target.value })} placeholder="Ej: títulos Amatic SC, textos Montserrat" />
          </div>
          <div className="space-y-1.5">
            <Label>Reglas de la marca y notas (qué logo sobre qué fondo, qué no decir, datos fijos, dirección…)</Label>
            <Textarea rows={3} value={form.marca.notas ?? ""} onChange={(e) => set("marca", { ...form.marca, notas: e.target.value })} />
          </div>
          <div className="border-t pt-3">
            <MarcaArchivos cliente={cliente} />
          </div>
        </div>
      </Section>

      <Section title="Contacto, redes y Meta">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Correos para el informe mensual
            </Label>
            <Input value={form.emails} onChange={(e) => set("emails", e.target.value)} placeholder="duenio@marca.com, socio@marca.com" disabled={!isAdmin} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Instagram</Label>
              <Input value={form.redes.instagram ?? ""} onChange={(e) => set("redes", { ...form.redes, instagram: e.target.value })} placeholder="@usuario" />
            </div>
            <div className="space-y-1.5">
              <Label>Facebook</Label>
              <Input value={form.redes.facebook ?? ""} onChange={(e) => set("redes", { ...form.redes, facebook: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>TikTok</Label>
              <Input value={form.redes.tiktok ?? ""} onChange={(e) => set("redes", { ...form.redes, tiktok: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Página web</Label>
              <Input value={form.redes.web ?? ""} onChange={(e) => set("redes", { ...form.redes, web: e.target.value })} placeholder="https://…" />
            </div>
          </div>
          <div className="rounded-lg border border-dashed p-3">
            <p className="text-xs font-semibold">Meta</p>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Los resultados ya se traen solos: alcanza con cargar el ID del anuncio en cada video. Estos IDs quedan
              listos para publicar y pautar desde el sistema más adelante.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input className="h-8 text-xs" value={form.meta.page_id ?? ""} onChange={(e) => set("meta", { ...form.meta, page_id: e.target.value })} placeholder="ID página FB" />
              <Input className="h-8 text-xs" value={form.meta.ig_user_id ?? ""} onChange={(e) => set("meta", { ...form.meta, ig_user_id: e.target.value })} placeholder="ID cuenta IG" />
              <Input className="h-8 text-xs" value={form.meta.ad_account_id ?? ""} onChange={(e) => set("meta", { ...form.meta, ad_account_id: e.target.value })} placeholder="act_… (anuncios)" />
            </div>
          </div>
        </div>
      </Section>

      <div className="flex justify-end lg:col-span-2">
        <Button onClick={save} disabled={saving} size="lg">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}

function toForm(c: Project) {
  const o = c.plan_redes_override ?? {};
  return {
    nombre: c.nombre,
    color: c.color || "#6F40FC",
    enabled: c.enabled !== false,
    planId: c.plan_redes_id ?? "",
    ovVideos: o.videos_mes != null ? String(o.videos_mes) : "",
    ovPrecio: o.precio_mensual != null ? String(o.precio_mensual) : "",
    ovExtra: o.precio_video_extra != null ? String(o.precio_video_extra) : "",
    ovPiezas: o.piezas_mes != null ? String(o.piezas_mes) : "",
    ovExtraTiktok: o.precio_extra_tiktok != null ? String(o.precio_extra_tiktok) : "",
    ovExtraYoutube: o.precio_extra_youtube != null ? String(o.precio_extra_youtube) : "",
    ovExtraShort: o.precio_extra_short != null ? String(o.precio_extra_short) : "",
    ovDuracion: { meta: o.duracion_extra?.meta != null ? String(o.duracion_extra.meta) : "", tiktok: o.duracion_extra?.tiktok != null ? String(o.duracion_extra.tiktok) : "", youtube: o.duracion_extra?.youtube != null ? String(o.duracion_extra.youtube) : "", short: o.duracion_extra?.short != null ? String(o.duracion_extra.short) : "" },
    ovRedes: { instagram: !!o.redes?.instagram, facebook: !!o.redes?.facebook, tiktok: !!o.redes?.tiktok, youtube: !!o.redes?.youtube },
    ovPauta: !!o.pauta?.incluida,
    ovPautaMonto: o.pauta?.monto != null ? String(o.pauta.monto) : "",
    ovAdminRedes: !!o.administracion_redes,
    factTipo: (c.facturacion?.tipo ?? "factura") as "boleta" | "factura",
    factRazon: c.facturacion?.razon_social ?? "",
    factCuit: c.facturacion?.cuit ?? "",
    factCondIva: (c.facturacion?.condicion_iva ?? "") as CondicionIva | "",
    factAdelantado: c.facturacion?.adelantado_hasta ?? "",
    factPagoDesde: plazoInicial(c.facturacion?.pago_desde),
    factPagoHasta: plazoInicial(c.facturacion?.pago_hasta),
    factModo: (c.facturacion?.modo_cobro === "adelantado" ? "adelantado" : "vencido") as "vencido" | "adelantado",
    factFijos: (c.facturacion?.extras_fijos ?? []).map((x) => ({ concepto: x.concepto, neto: String(x.neto) })),
    team: {
      productor: c.team_roles?.productor ?? [],
      editor: c.team_roles?.editor ?? [],
      pauta: c.team_roles?.pauta ?? [],
      diseno: c.team_roles?.diseno ?? [],
      cliente: c.team_roles?.cliente ?? [],
    } as Partial<Record<ProjectTeamRole, string[]>>,
    emails: (c.contacto_emails ?? []).join(", "),
    filma: quienFilma(c),
    publica: (c.produccion?.publica ?? "prodi") as QuienPublica,
    servicio: (c.produccion?.servicio === "solo_pauta" ? "solo_pauta" : "completo") as ServicioCliente,
    marca: { ...(c.marca ?? {}) },
    redes: { ...(c.redes ?? {}) },
    meta: { ...(c.meta ?? {}) },
  };
}

function InformeCliente({ cliente, mes }: { cliente: Project; mes: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState<null | "vista" | "enviar">(null);
  const emails = cliente.contacto_emails ?? [];

  const pedir = async (soloVista: boolean) => {
    setLoading(soloVista ? "vista" : "enviar");
    try {
      const res = await callApi<{ html?: string; enviados?: string[] }>("/api/informes/enviar", {
        proyecto_id: cliente.id,
        mes,
        solo_vista: soloVista,
      });
      if (soloVista) setHtml(res.html ?? "");
      else toast.success(`Informe enviado a ${res.enviados?.join(", ")}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo generar el informe");
    } finally {
      setLoading(null);
    }
  };

  const srcDoc = useMemo(() => html ?? "", [html]);

  return (
    <Section
      title={`Informe de ${mesLabel(mes).toLowerCase()}`}
      description={
        emails.length
          ? `Se envía solo el día 1 a: ${emails.join(", ")}`
          : "Cargá los correos del cliente en Configuración para que le llegue el informe."
      }
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => pedir(true)} disabled={!!loading}>
            {loading === "vista" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Eye className="mr-1.5 h-4 w-4" />}
            Vista previa
          </Button>
          <Button size="sm" onClick={() => pedir(false)} disabled={!!loading || emails.length === 0}>
            {loading === "enviar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Enviar ahora
          </Button>
        </div>
      }
    >
      {html !== null && (
        <iframe title="Vista previa del informe" srcDoc={srcDoc} className="h-[640px] w-full rounded-xl border bg-white" />
      )}
    </Section>
  );
}

/** Lista de opciones con un círculo (una sola elegida). */
function Opciones<T extends string>({ opciones, valor, onElegir, disabled }: { opciones: { v: T; titulo: string; texto: string }[]; valor: T; onElegir: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      {opciones.map((o) => (
        <button
          key={o.v}
          type="button"
          disabled={disabled}
          onClick={() => onElegir(o.v)}
          className={cn(
            "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed",
            valor === o.v ? "border-primary bg-primary/10" : "hover:border-primary/50 disabled:hover:border-border"
          )}
        >
          <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", valor === o.v ? "border-primary bg-primary" : "border-muted-foreground/40")}>
            {valor === o.v && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
          </span>
          <span>
            <span className="block text-sm font-medium">{o.titulo}</span>
            <span className="block text-xs text-muted-foreground">{o.texto}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
