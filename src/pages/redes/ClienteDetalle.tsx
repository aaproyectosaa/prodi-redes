import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { doc, updateDoc } from "@/lib/db";
import { ArrowLeft, Eye, Loader2, Mail, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { PlanificarDialog } from "@/components/redes/PlanificarDialog";
import { BotonArmarMes } from "@/components/redes/PlanesAviso";
import { ContextoComercialEditor } from "@/components/redes/ContextoComercial";
import { resumenMarca } from "@/lib/redes/proximoPaso";
import { ResultadosMes, resumirMes } from "@/components/redes/ResultadosMes";
import { EvolucionMensajes } from "@/components/redes/EvolucionMensajes";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { ETAPAS } from "@/lib/redes/etapas";
import { formatARS, mesActual, mesLabel, sumarMeses, fechaCorta } from "@/lib/redes/format";
import { planDe, usoPlan } from "@/lib/redes/planes";
import { callApi } from "@/lib/redes/api";
import type { Project, ProjectTeamRole } from "@/integrations/firebase/types";
import { COLORES } from "./Clientes";
import { MarcaArchivos } from "@/components/redes/MarcaArchivos";
import { DebitoAdmin } from "@/components/redes/Debito";
import { cn } from "@/lib/utils";
import { assertEditable } from "@/lib/redes/vistaComo";

export default function ClienteDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "resumen";
  const { clienteById, videos, planes, cobros } = useRedes();
  const { role } = useUserProfileContext();
  const cliente = clienteById(id);
  const [mes, setMes] = useState(mesActual());
  const [planificar, setPlanificar] = useState(false);
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
        <span className="flex items-center gap-3">
          <button type="button" onClick={() => navigate("/clientes")} className="text-muted-foreground hover:text-foreground" aria-label="Volver">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: cliente.color || "#6F40FC" }} />
          {cliente.nombre}
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
          <Button onClick={() => setPlanificar(true)}>
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
              <DebitoAdmin cliente={cliente} monto={planDe(cliente, planes).precioMensual} />
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
          </TabsContent>
        )}
      </Tabs>

      <PlanificarDialog open={planificar} onOpenChange={setPlanificar} clienteId={cliente.id} />
    </PageShell>
  );
}

const ROLES_EQUIPO: { rol: ProjectTeamRole; label: string; desc: string }[] = [
  { rol: "productor", label: "Producción", desc: "Planifica, filma y revisa" },
  { rol: "editor", label: "Edición", desc: "Edita los videos" },
  { rol: "pauta", label: "Pauta", desc: "Sube y pauta los videos" },
  { rol: "cliente", label: "Usuarios del cliente", desc: "Aprueban y ven resultados" },
];

function ConfigCliente({ cliente, isAdmin }: { cliente: Project; isAdmin: boolean }) {
  const { planes } = useRedes();
  const { profiles } = useAppData();
  const [form, setForm] = useState(() => toForm(cliente));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(toForm(cliente));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente.id]);

  const set = <K extends keyof ReturnType<typeof toForm>>(k: K, v: ReturnType<typeof toForm>[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

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
      const emails = form.emails
        .split(/[,\s;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /.+@.+\..+/.test(e));
      const data: Record<string, unknown> = {
        contacto_emails: emails,
        marca: form.marca,
        redes: form.redes,
        meta: form.meta,
      };
      if (isAdmin) {
        Object.assign(data, {
          nombre: form.nombre.trim() || cliente.nombre,
          color: form.color,
          enabled: form.enabled,
          plan_redes_id: form.planId || null,
          plan_redes_override: {
            videos_mes: form.ovVideos === "" ? null : Number(form.ovVideos),
            precio_mensual: form.ovPrecio === "" ? null : Number(form.ovPrecio),
            precio_video_extra: form.ovExtra === "" ? null : Number(form.ovExtra),
            piezas_mes: form.ovPiezas === "" ? null : Number(form.ovPiezas),
          },
          facturacion: {
            tipo: form.factTipo,
            razon_social: form.factRazon.trim() || null,
            cuit: form.factCuit.trim() || null,
            adelantado_hasta: /^\d{4}-\d{2}$/.test(form.factAdelantado) ? form.factAdelantado : null,
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

  const candidatos = (rol: ProjectTeamRole) =>
    profiles
      .filter((p) => (rol === "cliente" ? p.role === "cliente" : p.role === rol || p.role === "admin"))
      .sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? ""));

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
                  <Input inputMode="numeric" value={form.ovPiezas} onChange={(e) => set("ovPiezas", e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Videos/mes</Label>
                  <Input inputMode="numeric" value={form.ovVideos} onChange={(e) => set("ovVideos", e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Abono $</Label>
                  <Input inputMode="numeric" value={form.ovPrecio} onChange={(e) => set("ovPrecio", e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Video extra $</Label>
                  <Input inputMode="numeric" value={form.ovExtra} onChange={(e) => set("ovExtra", e.target.value.replace(/\D/g, ""))} />
                </div>
              </div>
            </div>
          </div>
        </Section>
      )}

      {isAdmin && (
        <Section title="Facturación" description="Cómo se le arma la boleta el 27.">
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1">
              {(["boleta", "factura"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("factTipo", t)}
                  className={cn("rounded-lg py-1.5 text-sm font-medium transition-all", form.factTipo === t ? "bg-background shadow-sm" : "text-muted-foreground")}
                >
                  {t === "boleta" ? "Boleta (sin IVA)" : "Factura (con IVA)"}
                </button>
              ))}
            </div>
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
            <div className="space-y-1">
              <Label className="text-xs">Pagó por adelantado hasta (mes)</Label>
              <Input type="month" value={form.factAdelantado} onChange={(e) => set("factAdelantado", e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Plan anual o trimestral: hasta ese mes la boleta sale como cobrada.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ítems que se suman todos los meses</Label>
              {form.factFijos.map((x, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={x.concepto}
                    onChange={(e) => set("factFijos", form.factFijos.map((y, j) => (j === i ? { ...y, concepto: e.target.value } : y)))}
                    placeholder="Ej.: Combustible"
                  />
                  <Input
                    inputMode="numeric"
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
              </div>
            ))}
          </div>
        </Section>
      )}

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
            <Label>Notas (qué no decir, datos fijos, dirección…)</Label>
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
            <Input value={form.emails} onChange={(e) => set("emails", e.target.value)} placeholder="duenio@marca.com, socio@marca.com" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
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
    factTipo: (c.facturacion?.tipo ?? "boleta") as "boleta" | "factura",
    factRazon: c.facturacion?.razon_social ?? "",
    factCuit: c.facturacion?.cuit ?? "",
    factAdelantado: c.facturacion?.adelantado_hasta ?? "",
    factFijos: (c.facturacion?.extras_fijos ?? []).map((x) => ({ concepto: x.concepto, neto: String(x.neto) })),
    team: {
      productor: c.team_roles?.productor ?? [],
      editor: c.team_roles?.editor ?? [],
      pauta: c.team_roles?.pauta ?? [],
      cliente: c.team_roles?.cliente ?? [],
    } as Partial<Record<ProjectTeamRole, string[]>>,
    emails: (c.contacto_emails ?? []).join(", "),
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
