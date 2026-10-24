import { useEffect, useMemo, useRef, useState } from "react";
import { loSubeElCliente } from "@/lib/redes/extra";
import { HorariosPublicar } from "@/components/redes/cliente/HorariosPublicar";
import { AvisoMoraCliente } from "@/components/redes/MoraAvisos";
import { useSearchParams } from "react-router-dom";
import { HelpCircle, Loader2, Minus, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell, Section, EmptyState } from "@/components/redes/PageShell";
import { VideoCard } from "@/components/redes/VideoCard";
import { PlanUsage } from "@/components/redes/PlanUsage";
import { PedirPiezaDialog, PiezaAprobarDialog, PiezaClienteCard } from "@/components/redes/PiezaDialogs";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { fechaCorta, formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { planDe, usoPlan } from "@/lib/redes/planes";
import { cupoPiezas, iniciarPago, verificarPago } from "@/lib/redes/piezas";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { MarcaArchivos } from "@/components/redes/MarcaArchivos";
import { DebitoCliente } from "@/components/redes/Debito";
import { ProximoPaso } from "@/components/redes/cliente/ProximoPaso";
import { CaminoVideos } from "@/components/redes/cliente/CaminoVideos";
import { GuiaCliente } from "@/components/redes/cliente/GuiaCliente";
import { PedirVideoDialog } from "@/components/redes/cliente/PedirVideoDialog";
import { DatosMarcaCliente, TarjetaPerfil } from "@/components/redes/cliente/PerfilCompleto";
import { PlanMesCliente } from "@/components/redes/cliente/PlanMesCliente";
import { usePlanMes } from "@/lib/redes/planMes";
import { MiPlan } from "@/components/redes/cliente/MiPlan";
import { ResultadosCliente } from "@/components/redes/cliente/ResultadosCliente";
import { CupoVideos } from "@/components/redes/cliente/CupoVideos";
import { MaterialCliente } from "@/components/redes/cliente/MaterialCliente";
import { ContextoComercialEditor } from "@/components/redes/ContextoComercial";
import { cn } from "@/lib/utils";
import { Contactos } from "@/components/redes/crm/Contactos";
import { EquipoCrm } from "@/components/redes/crm/EquipoCrm";
import { QueTeVende } from "@/components/redes/crm/QueTeVende";
import { CrmProximamente } from "@/components/redes/crm/CrmProximamente";
import { LogoCliente } from "@/components/redes/LogoCliente";
import { DATOS_COBRO_DEFAULT } from "@/lib/redes/types";
import { SelectorVista, VistaCalendario, useVista } from "@/components/redes/VistaCalendario";
import { faltaMarca, pasosCliente, resumenMarca } from "@/lib/redes/proximoPaso";

type Tab = "inicio" | "resultados" | "piezas" | "contactos" | "vende" | "equipo" | "material" | "plan" | "negocio";

const TITULOS: Partial<Record<Tab, string>> = {
  resultados: "Resultados",
  piezas: "Piezas gráficas",
  contactos: "Mis contactos",
  vende: "Qué te vende",
  equipo: "Equipo de ventas",
  material: "Material",
  plan: "Mi plan",
  negocio: "Mi negocio",
};
const SUBTITULOS: Partial<Record<Tab, string>> = {
  resultados: "Qué lograron tus videos con la pauta.",
  piezas: "Posteos, historias, afiches, carteles y banners con tu marca.",
  contactos: "Los que te escriben: a quién contestarle hoy, cuánto vendiste y cuánto te costó cada venta.",
  vende: "Qué video te trajo cada venta y qué te preguntan tus clientes (para tus próximos videos).",
  equipo: "Quiénes atienden tus contactos y cómo le va a cada uno este mes.",
  material: "Todo lo que filmamos y lo que ya está editado, para ver y descargar.",
  plan: "Si estás al día, qué incluye tu plan, cuánto usaste y tus boletas.",
  negocio: "Tu marca y lo que vendés: con esto armamos tus videos y piezas.",
};

function saludoDelDia() {
  const h = new Date().getHours();
  return h < 6 ? "Buenas noches" : h < 13 ? "Buen día" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

const fechaDeHoy = () => new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

export default function ClientePortal() {
  const { profile, user, viewingAs } = useUserProfileContext();
  const { clientes, videos, rodajes, piezas, planes, cobros } = useRedes();
  const [params, setParams] = useSearchParams();
  const tab = ((params.get("tab") as Tab) || "inicio") as Tab;
  const [clienteId, setClienteId] = useState<string>("");
  // El "+" del CRM (nuevo contacto o nuevo vendedor) va arriba, donde los otros módulos tienen "Pedir un video".
  const [crmNuevo, setCrmNuevo] = useState(false);
  const enCrm = tab === "contactos" || tab === "equipo";
  const cliente = clientes.find((c) => c.id === clienteId) ?? clientes[0];
  const mes = mesActual();
  const [mesRes, setMesRes] = useState(mes);
  const [piezaOpen, setPiezaOpen] = useState(false);
  const verificado = useRef(false);
  const [guia, setGuia] = useState(false);
  const [pedirVideo, setPedirVideo] = useState(false);
  // "Solo edición" desde Mi plan: el pedido arranca con "Yo mando el material".
  const [soloEdicion, setSoloEdicion] = useState(false);
  const [vista, setVista] = useVista("cliente");
  const guiaMostrada = useRef(false);
  const [planAbierto, setPlanAbierto] = useState<string | null>(null);
  const [piezaVer, setPiezaVer] = useState<string | null>(null);

  // Volver de Mercado Pago después de activar el débito automático.
  useEffect(() => {
    if (params.get("suscripcion") !== "ok") return;
    toast.success("¡Listo! Cuando Mercado Pago lo confirme, el abono se cobra solo cada mes.");
    const next = new URLSearchParams(params);
    for (const k of ["suscripcion", "preapproval_id"]) next.delete(k);
    setParams(next, { replace: true });
  }, [params, setParams]);

  // Volver de Mercado Pago: confirmar el pago.
  useEffect(() => {
    const cobro = params.get("cobro");
    if (!cobro || verificado.current) return;
    verificado.current = true;
    const estadoMp = params.get("pago");
    void (async () => {
      try {
        const res = await verificarPago(cobro);
        if (res.estado === "aprobado") toast.success("¡Pago acreditado! Ya nos pusimos a trabajar.");
        else if (estadoMp === "error" || res.estado === "rechazado") toast.error("El pago no se completó. Podés intentarlo de nuevo.");
        else toast.message("Estamos esperando la confirmación del pago de Mercado Pago.");
      } catch {
        /* el webhook igual lo va a confirmar */
      } finally {
        const next = new URLSearchParams(params);
        next.delete("cobro");
        next.delete("pago");
        next.delete("collection_id");
        next.delete("collection_status");
        next.delete("payment_id");
        next.delete("status");
        next.delete("external_reference");
        next.delete("payment_type");
        next.delete("merchant_order_id");
        next.delete("preference_id");
        next.delete("site_id");
        next.delete("processing_mode");
        next.delete("merchant_account_id");
        setParams(next, { replace: true });
      }
    })();
  }, [params, setParams]);

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    if (t === "inicio") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
  };

  const mios = useMemo(() => videos.filter((v) => v.proyecto_id === cliente?.id), [videos, cliente?.id]);
  const paraAprobar = mios.filter((v) => v.etapa === "revision_cliente");
  const delMes = mios.filter((v) => v.mes === mes);
  const uso = usoPlan(cliente, planes, videos, mes);
  const plan = planDe(cliente, planes);
  const misPiezas = piezas.filter((p) => p.proyecto_id === cliente?.id);
  const cupoP = cupoPiezas(cliente, planes, piezas, mes);
  const nombre = profile?.nombre?.split(" ")[0] ?? "";
  // Ideas del mes que mandó el equipo y esperan respuesta (este mes o el que viene).
  const { plan: planEste } = usePlanMes(cliente?.id, mes);
  const { plan: planProx } = usePlanMes(cliente?.id, sumarMeses(mes, 1));
  const planPend = [planEste, planProx].find((p) => p?.estado === "enviado") ?? null;
  // Si vino en una campaña de varios meses, se abre la campaña entera.
  const mesesPend = (planPend?.enviado_en_campania?.length ?? 0) > 1 ? planPend!.enviado_en_campania! : null;
  const abrirPend = planPend ? (mesesPend ? mesesPend.join(",") : planPend.mes) : null;
  const queFilmar = mesesPend
    ? `la campaña (${mesLabel(mesesPend[0]).split(" ")[0].toLowerCase()} a ${mesLabel(mesesPend[mesesPend.length - 1]).split(" ")[0].toLowerCase()})`
    : planPend
      ? mesLabel(planPend.mes).split(" ")[0].toLowerCase()
      : "";
  const pasos = useMemo(
    () =>
      cliente
        ? pasosCliente({
            cliente,
            videos,
            rodajes,
            piezas,
            cupo: uso.cupo,
            planPendiente: planPend
              ? { mes: planPend.mes, ideas: planPend.ideas.length, titulos: planPend.ideas.map((i) => i.titulo), campania: mesesPend ? queFilmar : null }
              : null,
          })
        : [],
    [cliente, videos, rodajes, piezas, uso.cupo, planPend, mesesPend, queFilmar]
  );

  // Link del aviso de pieza para aprobar: /cliente?tab=piezas&pieza=abc
  const piezaDeLink = params.get("pieza");
  useEffect(() => {
    if (!piezaDeLink) return;
    setPiezaVer(piezaDeLink);
    const next = new URLSearchParams(params);
    next.delete("pieza");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piezaDeLink]);

  // Link del aviso: /cliente?plan=2026-11 (o varios meses de una campaña: ?plan=2026-11,2026-12)
  const planDeLink = params.get("plan");
  useEffect(() => {
    if (!planDeLink) return;
    if (/^\d{4}-\d{2}(,\d{4}-\d{2}){0,11}$/.test(planDeLink)) setPlanAbierto(planDeLink);
    const next = new URLSearchParams(params);
    next.delete("plan");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planDeLink]);

  // Los datos de la marca son obligatorios: sin eso la bienvenida no se puede cerrar (el logo se pide, pero no frena).
  const falta = cliente ? faltaMarca(cliente) : { logo: false, info: false };
  const marcaObligatoria = falta.info && !viewingAs;

  // La primera vez que entra (o mientras falte la marca), la bienvenida se abre sola.
  useEffect(() => {
    if (guiaMostrada.current || !profile || !cliente) return;
    guiaMostrada.current = true;
    // En "ver como" el admin no necesita la bienvenida (la abre con "¿Cómo funciona?").
    if (viewingAs) return;
    if (!profile.guia_cliente_at || marcaObligatoria) setGuia(true);
  }, [profile, cliente, viewingAs, marcaObligatoria]);

  if (!cliente) {
    return (
      <PageShell title="Hola">
        <EmptyState title="Tu cuenta todavía no tiene una marca asignada" description="Avisale al equipo de Prodi." />
      </PageShell>
    );
  }

  return (
    <PageShell
      className={enCrm ? "max-w-none" : undefined}
      title={
        TITULOS[tab] ?? (
          <span>
            {saludoDelDia()}
            {nombre ? `, ${nombre}` : ""} <span className="inline-block origin-[70%_70%] animate-[saludo_1.6s_ease-in-out_1]">👋</span>
          </span>
        )
      }
      subtitle={tab === "inicio" ? <span className="inline-block first-letter:uppercase">{fechaDeHoy()}</span> : SUBTITULOS[tab]}
      actions={
        <>
          {/* Marca: con varias se elige acá; con una sola queda como etiqueta. */}
          {clientes.length > 1 ? (
            <Select value={cliente.id} onValueChange={setClienteId}>
              <SelectTrigger className="h-10 w-auto min-w-0 max-w-[15rem] gap-2 rounded-full border-border/60 bg-card/60 pl-1.5 pr-3 text-sm font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent focus:ring-primary/40">
                <SelectValue>
                  <span className="flex min-w-0 items-center gap-2">
                    <LogoCliente cliente={cliente} className="h-7 w-7 rounded-full text-[10px]" />
                    <span className="truncate">{cliente.nombre}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {clientes.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="rounded-lg">
                    <span className="flex items-center gap-2">
                      <LogoCliente cliente={c} className="h-6 w-6 rounded-full text-[9px]" />
                      {c.nombre}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="flex h-10 max-w-[15rem] items-center gap-2 rounded-full border border-border/60 bg-card/60 pl-1.5 pr-4 text-sm font-medium shadow-sm">
              <LogoCliente cliente={cliente} className="h-7 w-7 rounded-full text-[10px]" />
              <span className="truncate">{cliente.nombre}</span>
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setGuia(true)}
            title="¿Cómo funciona?"
            aria-label="¿Cómo funciona?"
            className="h-10 w-10 rounded-full border border-border/60 bg-card/60 text-muted-foreground shadow-sm hover:text-foreground"
          >
            <HelpCircle className="h-[18px] w-[18px]" />
          </Button>
          <Button
            onClick={() => (enCrm && cliente.crm_activo ? setCrmNuevo(true) : setPedirVideo(true))}
            className="group h-11 w-full rounded-full sm:h-10 sm:w-auto bg-gradient-to-r from-primary to-fuchsia-500 px-5 font-semibold shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/35"
          >
            <Plus className="mr-1.5 h-4 w-4 transition-transform group-hover:rotate-90" /> {cliente.crm_activo && tab === "contactos" ? "Nuevo contacto" : cliente.crm_activo && tab === "equipo" ? "Nuevo vendedor" : "Pedir un video"}
          </Button>
        </>
      }
    >
      <GuiaCliente
        open={guia}
        onOpenChange={setGuia}
        cliente={cliente}
        nombre={nombre}
        uid={user?.uid}
        obligatorio={marcaObligatoria}
        pasoInicial={profile?.guia_cliente_at && marcaObligatoria ? 3 : 0}
      />
      <PedirVideoDialog
        open={pedirVideo}
        onOpenChange={(v) => {
          setPedirVideo(v);
          if (!v) setSoloEdicion(false);
        }}
        cliente={cliente}
        soloEdicion={soloEdicion}
      />
      <PlanMesCliente
        proyectoId={cliente.id}
        mes={planAbierto}
        open={!!planAbierto}
        onOpenChange={(o) => !o && setPlanAbierto(null)}
        integrantes={cliente.team_roles?.cliente ?? []}
      />
      {/* Pagos atrasados: lo que debe y qué se le frena (arriba de todo, en cualquier sección). */}
      <AvisoMoraCliente cliente={cliente} onPagar={tab === "plan" ? undefined : () => setTab("plan")} />
      {/* Las secciones se eligen desde el menú: sin pestañas repetidas. */}
      <Tabs value={tab} onValueChange={setTab}>

        <TabsContent value="inicio" className="space-y-8">
          <TarjetaPerfil cliente={cliente} onCompletar={() => setTab("negocio")} />
          <ProximoPaso pasos={pasos} onPedir={() => setPedirVideo(true)} onIdeas={() => abrirPend && setPlanAbierto(abrirPend)} />
          {/* Si hay algo más urgente arriba, las ideas del mes quedan a un toque igual. */}
          {planPend && pasos[0]?.tipo !== "elegir_ideas" && (
            <button
              type="button"
              onClick={() => setPlanAbierto(abrirPend)}
              className="flex w-full items-center gap-3 rounded-2xl border-2 border-primary/60 bg-gradient-to-r from-primary/[0.14] to-primary/[0.04] p-4 text-left shadow-[0_0_32px_-14px_hsl(var(--primary)/0.9)] transition-all animate-in fade-in hover:-translate-y-0.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground" /> Esperamos tu respuesta</span>
                <span className="block text-sm font-semibold">Necesitamos tu OK para filmar {queFilmar}</span>
                <span className="block text-xs text-muted-foreground">
                  {mesesPend
                    ? "Te mandamos las ideas de todos los meses juntas: marcá cuáles van o contanos qué cambiar."
                    : `Te mandamos ${planPend.ideas.length === 1 ? "1 idea" : `${planPend.ideas.length} ideas`}: marcá cuáles van o contanos qué cambiar.`}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/30">Responder →</span>
            </button>
          )}
          {/* Las ideas ya respondidas se pueden volver a leer. */}
          {[planProx, planEste]
              .filter((p): p is NonNullable<typeof p> => !!p && p.id !== planPend?.id && !["borrador", "enviado"].includes(p.estado) && p.ideas.length > 0)
              .slice(0, 1)
              .map((p) => {
                // En qué quedó cada idea, dicho para el cliente.
                const estadoIdea = (i: (typeof p.ideas)[number]) =>
                  i.descartada
                    ? { label: "Descartada", clase: "bg-muted text-muted-foreground", tipo: "descartada" as const }
                    : i.video_id
                      ? { label: "Ya es un video", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", tipo: "lista" as const }
                      : i.respuesta?.ok === false
                        ? { label: "La estamos ajustando", clase: "bg-orange-500/15 text-orange-700 dark:text-orange-300", tipo: "ajuste" as const }
                        : i.respuesta?.ok
                          ? { label: "Aprobada", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", tipo: "lista" as const }
                          : { label: "Sin respuesta", clase: "bg-muted text-muted-foreground", tipo: "otra" as const };
                const estados = p.ideas.map(estadoIdea);
                const listas = estados.filter((e) => e.tipo === "lista").length;
                const ajuste = estados.filter((e) => e.tipo === "ajuste").length;
                const resumen = [
                  listas ? `${listas} ${listas === 1 ? "aprobada" : "aprobadas"}` : "",
                  ajuste ? `${ajuste} la${ajuste === 1 ? "" : "s"} estamos ajustando` : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <section key={p.id} className="overflow-hidden rounded-2xl border bg-card">
                    <div className="flex items-center gap-3 border-b bg-gradient-to-r from-primary/[0.08] to-transparent px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/25">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Tus ideas de {mesLabel(p.mes).split(" ")[0].toLowerCase()}</p>
                        <p className="text-xs text-muted-foreground">{resumen || "Ya las respondiste"} · gracias por responder</p>
                      </div>
                    </div>
                    <ul className="divide-y">
                      {p.ideas.slice(0, 5).map((i, n) => {
                        const e = estados[n];
                        return (
                          <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">{n + 1}</span>
                            <span className={cn("min-w-0 flex-1 truncate text-sm", e.tipo === "descartada" && "text-muted-foreground line-through")}>{i.titulo}</span>
                            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", e.clase)}>{e.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      onClick={() => setPlanAbierto(p.mes)}
                      className="flex w-full items-center justify-center gap-1 border-t px-4 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/[0.05]"
                    >
                      {p.ideas.length > 5 ? `Ver las ${p.ideas.length} ideas y el detalle` : "Ver el detalle de cada idea"} →
                    </button>
                  </section>
                );
              })}
          <CupoVideos uso={uso} mes={mes} precioExtra={plan.precioVideoExtra} onPedir={() => setPedirVideo(true)} />
          {/* Los que suben ellos sus videos: a qué hora conviene publicar. */}
          {(cliente.produccion?.publica === "cliente" || mios.some(loSubeElCliente)) && <HorariosPublicar cliente={cliente} />}

          <Section
            title={vista === "kanban" ? `Tus videos de ${mesLabel(mes).toLowerCase()}` : "Calendario de tus videos"}
            description={vista === "kanban" ? "Tocá cualquiera para verlo." : "Cuándo filmamos, para cuándo los pediste y cuándo salieron."}
            actions={<SelectorVista vista={vista} onChange={setVista} />}
          >
            {vista === "calendario" ? (
              <VistaCalendario videos={mios} mostrarCliente={false} />
            ) : delMes.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
                Todavía no planificamos los videos de este mes. Cuando acordemos las ideas, acá vas a ver el recorrido de cada uno.
              </p>
            ) : (
              <CaminoVideos videos={delMes} onPedir={() => setPedirVideo(true)} />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="resultados">
          <ResultadosCliente cliente={cliente} videos={videos} mes={mesRes} onMes={setMesRes} />
        </TabsContent>

        <TabsContent value="piezas" className="space-y-5">
          <div className="flex flex-col gap-4 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 font-semibold">
                <Sparkles className="h-4 w-4 text-primary" /> Posteos, historias, afiches, carteles o banners
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Para vender una promo o para comunicar algo. Nuestra diseñadora la arma con tu marca y te llega para aprobar.{" "}
                {cupoP.incluidas > 0
                  ? `Tu plan incluye ${cupoP.incluidas} por mes: ${cupoP.quedan === 0 ? "ya las usaste, las próximas se pagan aparte" : `te ${cupoP.quedan === 1 ? "queda 1" : `quedan ${cupoP.quedan}`}`}.`
                  : "Se pagan aparte con Mercado Pago."}
              </p>
            </div>
            <Button onClick={() => setPiezaOpen(true)} className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" /> Pedir pieza
            </Button>
          </div>
          {misPiezas.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {[...misPiezas]
                .sort((a, b) => Number(b.estado === "para_aprobar") - Number(a.estado === "para_aprobar"))
                .map((p) => (
                  <PiezaClienteCard key={p.id} pieza={p} onAbrir={() => setPiezaVer(p.id)} />
                ))}
            </div>
          )}
          {misPiezas.length === 0 && <PrimeraPieza onEmpezar={() => setPiezaOpen(true)} tieneLogo={!!cliente.marca_archivos?.logo} onMarca={() => setTab("negocio")} />}
          <PiezaAprobarDialog pieza={misPiezas.find((p) => p.id === piezaVer) ?? null} onClose={() => setPiezaVer(null)} />
        </TabsContent>

        <TabsContent value="material">
          <MaterialCliente videos={mios} piezas={misPiezas} cliente={cliente} />
        </TabsContent>

        <TabsContent value="plan">
          <MiPlan cliente={cliente} email={user?.email ?? undefined} onPedirVideo={() => setPedirVideo(true)}
            onPedirSoloEdicion={() => {
              setSoloEdicion(true);
              setPedirVideo(true);
            }}
            onPedirPieza={() => setPiezaOpen(true)}
            onCompletarPerfil={() => setTab("negocio")}
          />
        </TabsContent>

        {!cliente.crm_activo && cliente.crm_proximamente && (
          <>
            {(["contactos", "vende", "equipo"] as const).map((t) => (
              <TabsContent key={t} value={t}>
                <CrmProximamente seccion={t} />
              </TabsContent>
            ))}
          </>
        )}
        {cliente.crm_activo && (
          <TabsContent value="contactos">
            <Contactos cliente={cliente} nuevo={crmNuevo} onNuevo={setCrmNuevo} />
          </TabsContent>
        )}
        {cliente.crm_activo && (
          <TabsContent value="vende">
            <QueTeVende cliente={cliente} />
          </TabsContent>
        )}
        {cliente.crm_activo && (
          <TabsContent value="equipo">
            <EquipoCrm cliente={cliente} nuevo={crmNuevo} onNuevo={setCrmNuevo} />
          </TabsContent>
        )}

        <TabsContent value="negocio" className="space-y-6">
          <TarjetaPerfil cliente={cliente} onCompletar={() => document.getElementById("datos-marca")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
          <DatosMarcaCliente cliente={cliente} />
          <div className="rounded-2xl border bg-card p-5">
            <p className="font-semibold">Tu marca</p>
            <p className="mb-4 text-sm text-muted-foreground">Tu logo y tus colores: con esto salen las piezas y los videos con tu identidad.</p>
            <MarcaArchivos cliente={cliente} />
          </div>
          <div className="rounded-2xl border bg-card p-5 pb-0">
            <p className="font-semibold">Lo que vendés</p>
            <p className="mb-4 text-sm text-muted-foreground">
              Contanos qué vendés, qué querés empujar y qué tenés de temporada. Con esto armamos los videos y las piezas para que te traigan consultas y ventas.
            </p>
            <ContextoComercialEditor proyectoId={cliente.id} nombre={cliente.nombre} sugerido={resumenMarca(cliente)} cliente compacto />
          </div>
        </TabsContent>
      </Tabs>
      <PedirPiezaDialog open={piezaOpen} onOpenChange={setPiezaOpen} cliente={cliente} guiado={misPiezas.length === 0} />
    </PageShell>
  );
}

/** La primera vez: un camino guiado en vez de un cartel con pasos. */
function PrimeraPieza({ onEmpezar, tieneLogo, onMarca }: { onEmpezar: () => void; tieneLogo: boolean; onMarca: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed p-6 text-center">
      <Sparkles className="mx-auto h-8 w-8 text-primary" />
      <p className="mt-2 text-lg font-semibold">Pedí tu primera pieza</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Te vamos llevando de a una pregunta. Tarda un minuto y no hace falta saber de diseño.
      </p>
      <div className="mt-4 flex flex-col items-center gap-2">
        <Button onClick={onEmpezar}>Empezar</Button>
        {!tieneLogo && (
          <button type="button" onClick={onMarca} className="text-xs text-primary underline-offset-2 hover:underline">
            Antes, subí tu logo y tus colores
          </button>
        )}
      </div>
    </div>
  );
}
