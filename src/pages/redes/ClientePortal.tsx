import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HelpCircle, Loader2, Mail, Minus, Plus, Sparkles } from "lucide-react";
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
import { ResultadosMes, resumirMes } from "@/components/redes/ResultadosMes";
import { EvolucionMensajes } from "@/components/redes/EvolucionMensajes";
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
import { PlanMesCliente } from "@/components/redes/cliente/PlanMesCliente";
import { usePlanMes } from "@/lib/redes/planMes";
import { MiPlan } from "@/components/redes/cliente/MiPlan";
import { CupoVideos } from "@/components/redes/cliente/CupoVideos";
import { MaterialCliente } from "@/components/redes/cliente/MaterialCliente";
import { ContextoComercialEditor } from "@/components/redes/ContextoComercial";
import { cn } from "@/lib/utils";
import { DATOS_COBRO_DEFAULT } from "@/lib/redes/types";
import { SelectorVista, VistaCalendario, useVista } from "@/components/redes/VistaCalendario";
import { faltaMarca, pasosCliente, resumenMarca } from "@/lib/redes/proximoPaso";

type Tab = "inicio" | "resultados" | "piezas" | "material" | "plan" | "negocio";

const TITULOS: Partial<Record<Tab, string>> = {
  resultados: "Resultados",
  piezas: "Piezas gráficas",
  material: "Material",
  plan: "Mi plan",
  negocio: "Mi negocio",
};
const SUBTITULOS: Partial<Record<Tab, string>> = {
  resultados: "Qué lograron tus videos con la pauta.",
  piezas: "Posteos, historias, afiches, carteles y banners con tu marca.",
  material: "Todo lo que filmamos y lo que ya está editado, para ver y descargar.",
  plan: "Si estás al día, qué incluye tu plan, cuánto usaste y tus boletas.",
  negocio: "Tu marca y lo que vendés: con esto armamos tus videos y piezas.",
};

export default function ClientePortal() {
  const { profile, user, viewingAs } = useUserProfileContext();
  const { clientes, videos, rodajes, piezas, planes, cobros } = useRedes();
  const [params, setParams] = useSearchParams();
  const tab = ((params.get("tab") as Tab) || "inicio") as Tab;
  const [clienteId, setClienteId] = useState<string>("");
  const cliente = clientes.find((c) => c.id === clienteId) ?? clientes[0];
  const mes = mesActual();
  const [mesRes, setMesRes] = useState(mes);
  const [piezaOpen, setPiezaOpen] = useState(false);
  const verificado = useRef(false);
  const [guia, setGuia] = useState(false);
  const [pedirVideo, setPedirVideo] = useState(false);
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
  const resumen = resumirMes(videos, cliente?.id ?? "", mesRes);
  const nombre = profile?.nombre?.split(" ")[0] ?? "";
  // Ideas del mes que mandó el equipo y esperan respuesta (este mes o el que viene).
  const { plan: planEste } = usePlanMes(cliente?.id, mes);
  const { plan: planProx } = usePlanMes(cliente?.id, sumarMeses(mes, 1));
  const planPend = [planEste, planProx].find((p) => p?.estado === "enviado") ?? null;
  const pasos = useMemo(
    () =>
      cliente
        ? pasosCliente({
            cliente,
            videos,
            rodajes,
            piezas,
            cupo: uso.cupo,
            planPendiente: planPend ? { mes: planPend.mes, ideas: planPend.ideas.length } : null,
          })
        : [],
    [cliente, videos, rodajes, piezas, uso.cupo, planPend]
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

  // Link del aviso: /cliente?plan=2026-11
  const planDeLink = params.get("plan");
  useEffect(() => {
    if (!planDeLink) return;
    if (/^\d{4}-\d{2}$/.test(planDeLink)) setPlanAbierto(planDeLink);
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
      title={TITULOS[tab] ?? `Hola${nombre ? `, ${nombre}` : ""}`}
      subtitle={tab === "inicio" ? cliente.nombre : SUBTITULOS[tab]}
      actions={
        <>
        <Button variant="outline" size="sm" onClick={() => setGuia(true)}>
          <HelpCircle className="mr-1.5 h-4 w-4" /> ¿Cómo funciona?
        </Button>
        <Button size="sm" onClick={() => setPedirVideo(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Pedir un video
        </Button>
        {clientes.length > 1 && (
          <Select value={cliente.id} onValueChange={setClienteId}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {clientes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
      <PedirVideoDialog open={pedirVideo} onOpenChange={setPedirVideo} cliente={cliente} />
      <PlanMesCliente proyectoId={cliente.id} mes={planAbierto} open={!!planAbierto} onOpenChange={(o) => !o && setPlanAbierto(null)} />
      {/* Las secciones se eligen desde el menú: sin pestañas repetidas. */}
      <Tabs value={tab} onValueChange={setTab}>

        <TabsContent value="inicio" className="space-y-8">
          <ProximoPaso pasos={pasos} onPedir={() => setPedirVideo(true)} onIdeas={() => planPend && setPlanAbierto(planPend.mes)} />
          <CupoVideos uso={uso} mes={mes} precioExtra={plan.precioVideoExtra} onPedir={() => setPedirVideo(true)} />
          {/* Si hay algo más urgente arriba, las ideas del mes quedan a un toque igual. */}
          {planPend && pasos[0]?.tipo !== "elegir_ideas" && (
            <button
              type="button"
              onClick={() => setPlanAbierto(planPend.mes)}
              className="flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-primary/[0.05] p-3.5 text-left transition-all animate-in fade-in hover:-translate-y-0.5 hover:shadow-sm"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Elegí tus videos de {mesLabel(planPend.mes).split(" ")[0].toLowerCase()}</span>
                <span className="block text-xs text-muted-foreground">
                  Te armamos {planPend.ideas.length === 1 ? "1 idea" : `${planPend.ideas.length} ideas`}. Marcá cuáles van.
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-primary">Ver ideas →</span>
            </button>
          )}

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

        <TabsContent value="resultados" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Select value={mesRes} onValueChange={setMesRes}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, -1, -2, -3, -4, -5].map((d) => {
                  const m = sumarMeses(mes, d);
                  return (
                    <SelectItem key={m} value={m}>
                      {mesLabel(m)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {(cliente.contacto_emails?.length ?? 0) > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="h-3.5 w-3.5" /> El día 1 de cada mes te llega este informe por correo.
              </p>
            )}
          </div>
          <ResultadosMes
            resumen={resumen}
            grafico={<EvolucionMensajes videos={videos} proyectoId={cliente.id} mes={mesRes} onMes={setMesRes} />}
          />
          <details className="group rounded-2xl border bg-card p-4">
            <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-semibold">
              <HelpCircle className="h-4 w-4 text-primary" /> ¿Qué significa cada número?
            </summary>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              {[
                ["Mensajes recibidos", "Las consultas que te llegaron por WhatsApp, Instagram o Messenger gracias a la pauta. Es el número más importante."],
                ["Personas alcanzadas", "Cuánta gente distinta vio tus videos."],
                ["Reproducciones", "Cuántas veces se reprodujeron tus videos."],
                ["Inversión en pauta", "Lo que se invirtió en Meta para mostrar tus videos. Abajo ves cuánto costó cada mensaje."],
              ].map(([t, d]) => (
                <div key={t}>
                  <dt className="font-medium">{t}</dt>
                  <dd className="text-xs text-muted-foreground">{d}</dd>
                </div>
              ))}
            </dl>
          </details>
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
          <MiPlan cliente={cliente} email={user?.email ?? undefined} onPedirVideo={() => setPedirVideo(true)} onPedirPieza={() => setPiezaOpen(true)} />
        </TabsContent>

        <TabsContent value="negocio" className="space-y-6">
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
