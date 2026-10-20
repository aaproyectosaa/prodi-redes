import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CobrosExtras, useExtrasDelMes } from "@/components/redes/admin/CobrosExtras";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  Check,
  ChevronDown,
  Clock,
  Eye,
  FileSpreadsheet,
  Loader2,
  Mail,
  Copy,
  MoreHorizontal,
  Pencil,
  Receipt,
  Search,
  Send,
  Trash2,
  Undo2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/redes/PageShell";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { BoletaDialog } from "@/components/redes/admin/BoletaDialog";
import { DatosFacturacionDialog, EditarFacturaDialog, MesNav } from "@/components/redes/admin/FacturaPartes";
import { PagoParcialDialog } from "@/components/redes/admin/PagoParcialDialog";
import { Morosos, useMorosos } from "@/components/redes/admin/Morosos";
import { ComoFunciona, FilaKpis, Kpi, Pestanias, Vacio as VacioAdmin, type Pestania } from "@/components/redes/admin/AdminUI";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { armarFactura, facturaId } from "../../../api/_lib/facturacion";
import { doc, getDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { useRedes } from "@/contexts/redes-data-context";
import { formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { planDe } from "@/lib/redes/planes";
import {
  DIA_VENCIMIENTO,
  MEDIOS,
  anularFactura,
  nombrePeriodo,
  periodoDe,
  periodoFactura,
  textoMora,
  descargarPlanilla,
  emitirAClientes,
  prepararFacturacion,
  marcarCobrada,
  sincronizarBorrador,
  agrupadasDe,
  vaEnOtraBoleta,
  pagadoDe,
  registrarPago,
  saldoDe,
  reactivarFactura,
  textoCobro,
  useFacturas,
  volverAPendiente,
  volverASinEmitir,
  type Factura,
  type FacturaDoc,
  type MedioCobro,
} from "@/lib/redes/facturacion";
import { DATOS_COBRO_DEFAULT } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Algo salió mal");
type Paso = "emitir" | "cobrar" | "cobradas" | "morosos" | "extras";

/**
 * Cobros a clientes, en dos pasos: 1) elegir a quién emitirle la boleta del mes (le llega a su panel
 * y por mail), 2) marcar lo que se cobró.
 */
export default function Cobros() {
  const [params, setParams] = useSearchParams();
  const [mes, setMes] = useState(params.get("mes") ?? mesActual());
  useEffect(() => {
    if (!params.get("mes")) return;
    const next = new URLSearchParams(params);
    next.delete("mes");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { clientes, planes, settings } = useRedes();
  const { facturas: todas, loading } = useFacturas(mes);
  // Morosos: las vencidas pueden ser de meses anteriores.
  const { facturas: delAnio } = useFacturas(sumarMeses(mesActual(), -12));
  const facturas = useMemo(() => todas.filter((f) => f.mes === mes).sort((a, b) => a.cliente.localeCompare(b.cliente)), [todas, mes]);
  const cobro = { ...DATOS_COBRO_DEFAULT, ...(settings.cobro ?? {}) };
  const hoy = hoyISO();

  const vivas = facturas.filter((f) => f.estado !== "anulada");
  const borradores = vivas.filter((f) => f.estado === "borrador");
  // Las armadas que no se emitieron siguen los datos de facturación del cliente (boleta / factura, razón social, CUIT).
  const sincronizadas = useRef(new Set<string>());
  useEffect(() => {
    for (const f of borradores) {
      const c = clientes.find((x) => x.id === f.proyecto_id);
      const abono = c ? planDe(c, planes).precioMensual : 0;
      // Empresas del mismo dueño que van en esta misma boleta.
      const agrupadas = c ? agrupadasDe(c.id, clientes, (x) => planDe(x, planes).precioMensual) : [];
      const clave = `${f.id}:${abono}:${JSON.stringify(c?.facturacion ?? null)}:${JSON.stringify(agrupadas)}`;
      if (!c || sincronizadas.current.has(clave)) continue;
      sincronizadas.current.add(clave);
      void sincronizarBorrador(f, c, abono, settings.iva_pct ?? 21, agrupadas).catch((e) => console.warn("[cobros] sincronizar", f.id, e));
    }
  }, [borradores, clientes, planes, settings.iva_pct]);
  const pendientes = vivas
    .filter((f) => f.estado === "pendiente")
    .sort((a, b) => Number(b.vencimiento < hoy) - Number(a.vencimiento < hoy) || a.vencimiento.localeCompare(b.vencimiento));
  const cobradas = vivas.filter((f) => f.estado === "cobrada");
  const anuladas = facturas.filter((f) => f.estado === "anulada");
  const total = vivas.filter((f) => f.estado !== "borrador").reduce((a, f) => a + f.bruto, 0);
  const cobrado = cobradas.reduce((a, f) => a + f.bruto, 0) + vivas.filter((f) => f.estado !== "cobrada").reduce((a, f) => a + pagadoDe(f), 0);

  // Para emitir: los clientes con plan que todavía no tienen boleta este mes (se arma al emitir)
  // y las que ya estaban armadas (el 27 se arman solas) pero no se mandaron.
  const porEmitir: PorEmitir[] = useMemo(() => {
    const ivaPct = settings.iva_pct ?? 21;
    const dia = settings.dia_vencimiento ?? DIA_VENCIMIENTO;
    const filas: PorEmitir[] = borradores.map((f) => ({ pid: f.proyecto_id, f, doc: f }));
    for (const c of clientes) {
      if (facturas.some((f) => f.proyecto_id === c.id)) continue;
      // Va dentro de la boleta de otra empresa del mismo dueño: no tiene boleta propia.
      if (vaEnOtraBoleta(c, clientes)) continue;
      const plan = planDe(c, planes);
      const agrupadas = agrupadasDe(c.id, clientes, (x) => planDe(x, planes).precioMensual);
      if (!plan.precioMensual && !agrupadas.length) continue;
      const f = armarFactura(
        {
          id: c.id,
          nombre: c.nombre,
          abono: plan.precioMensual,
          planNombre: plan.nombre,
          facturacion: c.facturacion ?? null,
          agrupadas,
          debitoActivo: c.suscripcion?.estado === "activa",
        },
        mes,
        { ivaPct, diaVencimiento: dia, por: "", hoy }
      );
      filas.push({ pid: c.id, f });
    }
    return filas.sort((a, b) => a.f.cliente.localeCompare(b.f.cliente));
  }, [borradores, clientes, facturas, planes, settings.iva_pct, settings.dia_vencimiento, mes, hoy]);

  const morosos = useMorosos(delAnio);
  const sugerido: Paso = porEmitir.length ? "emitir" : pendientes.length ? "cobrar" : morosos.filas.length ? "morosos" : "cobradas";
  const [paso, setPaso] = useState<Paso>(sugerido);
  const [tocado, setTocado] = useState(false);
  useEffect(() => {
    if (!tocado) setPaso(sugerido);
  }, [sugerido, tocado]);
  useEffect(() => setTocado(false), [mes]);
  const ir = (p: Paso) => {
    setTocado(true);
    setPaso(p);
  };

  // Por id: así se ve en vivo lo que cambia (p. ej. el CAE de ARCA apenas se autoriza).
  const [verId, setVerId] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Factura | null>(null); // vista previa que todavía no se guardó
  const ver = facturas.find((x) => x.id === verId) ?? previa;
  const abrir = (f: Factura) => ("id" in f && typeof f.id === "string" ? (setVerId(f.id), setPrevia(null)) : (setVerId(null), setPrevia(f)));
  const [editar, setEditar] = useState<FacturaDoc | null>(null);
  const [editarPid, setEditarPid] = useState<string | null>(null);
  const [datosDe, setDatosDe] = useState<string | null>(null);
  // "Editar" en una boleta que todavía no existe: la arma y la abre apenas llega.
  useEffect(() => {
    if (!editarPid) return;
    const f = facturas.find((x) => x.proyecto_id === editarPid);
    if (f) {
      setEditar(f);
      setEditarPid(null);
    }
  }, [editarPid, facturas]);
  const editarFila = async (r: PorEmitir) => {
    if (r.doc) return setEditar(r.doc);
    try {
      setEditarPid(r.pid);
      await prepararFacturacion(mes, [r.pid]);
    } catch (e) {
      setEditarPid(null);
      err(e);
    }
  };

  // Buscador: por nombre del cliente (sin acentos ni mayúsculas).
  const [q, setQ] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const coincide = (nombre: string) => !q.trim() || norm(nombre).includes(norm(q.trim()));
  const porEmitirV = porEmitir.filter((r) => coincide(r.f.cliente));
  const pendientesV = pendientes.filter((x) => coincide(x.cliente));
  const cobradasV = cobradas.filter((x) => coincide(x.cliente));
  const delAnioV = q.trim() ? delAnio.filter((x) => coincide(x.cliente)) : delAnio;
  const vencidoBoletas = pendientes.filter((f) => f.vencimiento < hoy);
  // Lo que pagan solos los clientes por Mercado Pago (videos extra, piezas, viáticos) en este mes.
  const extrasMes = useExtrasDelMes(periodoDe(mes));
  const pestanias: Pestania<Paso>[] = [
    { k: "emitir", label: "Emitir", n: porEmitir.length, listo: vivas.length > 0 && porEmitir.length === 0 },
    { k: "cobrar", label: "Por cobrar", n: pendientes.length, alerta: vencidoBoletas.length > 0, listo: vivas.length > 0 && !pendientes.length && !porEmitir.length },
    { k: "cobradas", label: "Cobradas", n: cobradas.length },
    { k: "morosos", label: "Morosos", n: morosos.filas.length, alerta: morosos.filas.length > 0 },
    { k: "extras", label: "Extras", n: extrasMes.filter((c) => c.estado === "aprobado").length },
  ];
  const periodo = mesLabel(periodoDe(mes)).split(" ")[0].toLowerCase();

  return (
    <PageShell
      title="Cobros"
      subtitle={`Boletas de ${periodo}: emitilas, marcá lo que entra y seguí a los que deben.`}
      actions={
        <>
          {vivas.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => descargarPlanilla(vivas, mes)}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Planilla
            </Button>
          )}
          {/* Se navega por el mes en que se emiten (el del 27), pero se muestra el período que cubren. */}
          <MesNav mes={mes} setMes={setMes} max={sumarMeses(mesActual(), 1)} etiqueta={(m) => `Boletas de ${mesLabel(periodoDe(m)).toLowerCase()}`} />
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5">
          <FilaKpis>
            <Kpi icono={Receipt} label="Emitido" valor={formatARS(total)} sub={porEmitir.length ? `${porEmitir.length} por emitir` : "Todas emitidas"} tono="violeta" onClick={() => ir("emitir")} />
            <Kpi
              icono={Wallet}
              label="Cobrado"
              valor={formatARS(cobrado)}
              avance={total ? cobrado / total : 0}
              sub={total ? `${Math.round((cobrado / total) * 100)}% de lo emitido` : "—"}
              tono="verde"
              onClick={() => ir("cobradas")}
            />
            <Kpi icono={Clock} label="Falta cobrar" valor={formatARS(Math.max(0, total - cobrado))} sub={`${pendientes.length} boleta${pendientes.length === 1 ? "" : "s"}`} tono="ambar" onClick={() => ir("cobrar")} />
            <Kpi
              icono={AlertTriangle}
              label="Atrasado (con interés)"
              valor={formatARS(morosos.total)}
              sub={morosos.filas.length ? `${morosos.filas.length} cliente${morosos.filas.length === 1 ? "" : "s"}` : "Nadie atrasado"}
              tono={morosos.filas.length ? "rojo" : "gris"}
              onClick={() => ir("morosos")}
            />
          </FilaKpis>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Pestanias items={pestanias} valor={paso} onChange={ir} />
            {/* Buscar un cliente: filtra todas las pestañas. */}
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar cliente…"
                className="h-10 w-full rounded-xl border bg-card pl-9 pr-9 text-sm outline-none transition-colors focus:border-primary"
              />
              {q && (
                <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground" aria-label="Borrar búsqueda">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {q && !porEmitirV.length && !pendientesV.length && !cobradasV.length && !delAnioV.length && (
            <p className="text-sm text-muted-foreground">Ningún cliente coincide con «{q}».</p>
          )}

          <div key={`${mes}-${paso}`} className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
            {paso === "emitir" && (
              <PasoEmitir
                mes={mes}
                lista={porEmitirV}
                anuladas={anuladas}
                onVer={abrir}
                onEditar={(r) => void editarFila(r)}
                editando={editarPid}
                onDatos={setDatosDe}
                onEmitidas={() => ir("cobrar")}
              />
            )}
            {paso === "cobrar" && <PasoCobrar lista={pendientesV} hoy={hoy} cobro={cobro} onVer={abrir} />}
            {paso === "cobradas" &&
              (cobradasV.length ? (
                <div className="divide-y rounded-2xl border bg-card px-4">
                {cobradasV.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{f.cliente}</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {MEDIOS.find((m) => m.value === f.medio)?.label ?? "Cobrada"}
                    </span>
                    <span className="tabular-nums">
                      {formatARS(f.bruto)}
                      {f.interes_cobrado ? <span className="ml-1 text-xs text-muted-foreground">+ {formatARS(f.interes_cobrado)} interés</span> : null}
                    </span>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setVerId(f.id)} aria-label="Ver boleta">
                      <Eye className="h-4 w-4" />
                    </Button>
                    {f.medio !== "mercadopago" && f.medio !== "adelantado" &&
                      (f.emitida_por ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => void volverAPendiente(f).then(() => toast.success("Volvió a “por cobrar”")).catch(err)}
                          aria-label="No estaba cobrada"
                          title="No estaba cobrada"
                        >
                          <Undo2 className="h-4 w-4" />
                        </Button>
                      ) : (
                        // Se marcó "ya pagó" sin emitirla: se deshace del todo (vuelve a "Emitir" de este mes).
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs"
                          onClick={() => void volverASinEmitir(f).then(() => toast.success(`${f.cliente}: se deshizo el pago, vuelve a «Emitir»`)).catch(err)}
                          title="Me equivoqué: no pagó este mes"
                        >
                          <Undo2 className="mr-1 h-3.5 w-3.5" /> Deshacer
                        </Button>
                      ))}
                  </div>
                ))}
              </div>
              ) : (
                <VacioAdmin icono={Wallet} titulo="Todavía no se cobró nada este mes" texto="Cuando marques una boleta como cobrada (o pague por Mercado Pago) aparece acá." />
              ))}
            {paso === "extras" && <CobrosExtras mes={periodoDe(mes)} filtro={coincide} />}
            {paso === "morosos" &&
              (morosos.filas.length ? <Morosos facturas={delAnioV} embebido /> : <VacioAdmin icono={Check} titulo="Nadie está atrasado" texto="Todos los clientes están al día con sus boletas." />)}
          </div>

          <ComoFunciona>
            <p>
              <b>Mes vencido</b>: el 27 de cada mes se arman solas las boletas de ese mes. Las revisás y las <b>emitís</b>: al cliente le llega a su panel con un aviso
              y una copia por mail. Se pagan del 1 al {settings.dia_vencimiento ?? DIA_VENCIMIENTO} del mes siguiente (salvo los clientes con otro plazo). A los de
              <b> mes adelantado</b> se les factura el mes que viene.
            </p>
            <p>
              Después del vencimiento corre un <b>0,5% de interés por día</b> y se le recuerda solo. Si se sigue atrasando entra en <b>mora</b>: primero se le frenan
              los extras y después la producción (los días se cambian en Ajustes → Mora).
            </p>
            <p>Los que pagan con débito automático se marcan solos cuando Mercado Pago cobra.</p>
            <p>
              <b>Extras</b>: los videos extra, piezas aparte y viáticos que el cliente paga por Mercado Pago se cobran solos y aparecen en esa pestaña, con lo que se
              quedó Mercado Pago y <b>cuándo se libera la plata</b> (Mercado Pago la retiene unos días antes de que se pueda usar).
            </p>
          </ComoFunciona>
        </div>
      )}

      <BoletaDialog f={ver} cobro={cobro} onClose={() => (setVerId(null), setPrevia(null))} arca />
      <EditarFacturaDialog f={editar} onClose={() => setEditar(null)} ivaPct={settings.iva_pct ?? 21} />
      <DatosFacturacionDialog proyectoId={datosDe} onClose={() => setDatosDe(null)} />
    </PageShell>
  );
}

// ---------------------------------------------------------------------------

interface PorEmitir {
  pid: string;
  /** La boleta tal como va a salir (la armada o una vista previa). */
  f: Factura;
  /** Ya armada (el 27 o con "Editar"). */
  doc?: FacturaDoc;
}

function PasoEmitir({
  mes,
  lista,
  anuladas,
  onVer,
  onEditar,
  editando,
  onDatos,
  onEmitidas,
}: {
  mes: string;
  lista: PorEmitir[];
  anuladas: FacturaDoc[];
  onVer: (f: Factura) => void;
  onEditar: (r: PorEmitir) => void;
  editando: string | null;
  onDatos: (id: string) => void;
  onEmitidas: () => void;
}) {
  const { clienteById } = useRedes();
  // Nadie viene tildado: vos elegís a quién emitirle.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setSel((prev) => new Set([...prev].filter((id) => lista.some((r) => r.pid === id)))), [lista]);
  const elegidas = lista.filter((r) => sel.has(r.pid));
  const totalSel = elegidas.reduce((a, r) => a + r.f.bruto, 0);
  const todas = lista.length > 0 && elegidas.length === lista.length;

  /**
   * Ya pagó (por transferencia, efectivo…) antes de que se le emitiera: queda cobrada sin mandarle nada.
   * Si la boleta todavía era una vista previa, primero se arma.
   */
  const { user } = useUserProfileContext();
  const [parcial, setParcial] = useState<PorEmitir | null>(null);
  /** La boleta guardada (si todavía era una vista previa, se arma). */
  const asegurarDoc = async (r: PorEmitir): Promise<FacturaDoc> => {
    if (r.doc) return r.doc;
    await prepararFacturacion(mes, [r.pid]);
    const id = facturaId(r.pid, mes);
    const snap = await getDoc(doc(db, "facturas", id));
    if (!snap.exists()) throw new Error("No se pudo armar la boleta");
    return { ...(snap.data() as Factura), id } as FacturaDoc;
  };
  const yaPago = async (r: PorEmitir, medio: MedioCobro) => {
    setBusy(r.pid);
    try {
      const f = await asegurarDoc(r);
      await marcarCobrada(f, medio);
      toast.success(`${r.f.cliente}: registrado el pago de ${formatARS(r.f.bruto)}`);
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };

  const emitir = async (filas: PorEmitir[], clave: string) => {
    setBusy(clave);
    try {
      const r = await emitirAClientes(mes, filas.map((x) => x.pid));
      const cobradas = filas.length - r.emitidas;
      toast.success(
        `${r.emitidas === 1 ? "Emitida" : `Emitidas ${r.emitidas}`}: ya la tienen en su panel${r.mails ? ` y les llegó por mail (${r.mails})` : ""}.${
          r.sin_mail.length ? ` Sin mail cargado: ${r.sin_mail.join(", ")}.` : ""
        }${r.falla_mail?.length ? ` No salió el mail a ${r.falla_mail.join(", ")} (revisá la configuración de correo).` : ""
        }${cobradas > 0 ? ` ${cobradas} ya estaban pagas (adelantado o débito).` : ""}`,
        { duration: 7000 }
      );
      setSel(new Set());
      if (filas.length === lista.length) onEmitidas();
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {lista.length === 0 ? (
        <Vacio texto="Ya les emitiste a todos este mes 👌" />
      ) : (
        <>
          <Ayuda>
            Tildá y tocá <b>Emitir</b>: le llega al panel y por mail. Con <b>Ver</b> la mirás antes.
          </Ayuda>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground">
              <Checkbox checked={todas} onCheckedChange={() => setSel(todas ? new Set() : new Set(lista.map((r) => r.pid)))} aria-label="Tildar todos" />
              {todas ? "Destildar todos" : `Tildar todos (${lista.length})`}
            </label>
          </div>
          {lista.map((r, i) => {
            const marcada = sel.has(r.pid);
            const yaPaga = r.f.estado === "cobrada";
            return (
              <div
                key={r.pid}
                style={{ animationDelay: `${i * 30}ms` }}
                className={cn(
                  "rounded-xl border bg-card p-3 transition-colors animate-in fade-in slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none",
                  marcada && "border-primary bg-primary/[0.05]"
                )}
              >
                <div className="flex items-start gap-3">
                  <Checkbox checked={marcada} onCheckedChange={() => toggle(setSel, r.pid)} className="mt-1" aria-label={`Elegir ${r.f.cliente}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <ClienteTag cliente={clienteById(r.pid)} size="md" className="font-semibold text-foreground" />
                      <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{r.f.tipo}</span>
                      {r.f.debito && <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">Débito automático</span>}
                      {periodoFactura(r.f) !== r.f.mes && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          Mes adelantado · {nombrePeriodo(r.f)}
                        </span>
                      )}
                      <span className="ml-auto font-bold tabular-nums">{formatARS(r.f.bruto)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.f.items.map((x) => x.concepto).join(" + ") || "Sin ítems: tocá Editar"}
                      {r.f.iva ? ` · IVA ${r.f.iva_pct}%` : ""}
                      {yaPaga ? " · ya está paga (por adelantado)" : ""}
                    </p>
                    {r.doc?.pagos?.length ? (
                      <p className="mt-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        Pagó {formatARS(pagadoDe(r.doc))} a cuenta · falta {formatARS(saldoDe(r.doc))}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => onVer(r.f)}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> Ver
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => onEditar(r)} disabled={editando === r.pid}>
                        {editando === r.pid ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Pencil className="mr-1 h-3.5 w-3.5" />} Editar
                      </Button>
                      <Button size="sm" className="h-8" onClick={() => void emitir([r], r.pid)} disabled={!!busy || r.f.items.length === 0}>
                        {busy === r.pid ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />} Emitir
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Más opciones">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onDatos(r.pid)}>
                            <Receipt className="mr-2 h-4 w-4" /> Datos de facturación del cliente
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={!!busy} onClick={() => setParcial(r)}>
                            <Banknote className="mr-2 h-4 w-4" /> Pagó una parte…
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Ya pagó todo (sin emitirle):</DropdownMenuLabel>
                          {MEDIOS.filter((m) => m.value !== "adelantado").map((m) => (
                            <DropdownMenuItem key={m.value} disabled={!!busy} onClick={() => void yaPago(r, m.value)}>
                              <Banknote className="mr-2 h-4 w-4" /> {m.label}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          {/* Este mes no contrató (o no corresponde): no se le arma ni se le manda nada. Se puede volver a facturar abajo. */}
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={!!busy}
                            onClick={() =>
                              void asegurarDoc(r)
                                .then(anularFactura)
                                .then(() => toast.success(`${r.f.cliente}: no se le factura este mes`))
                                .catch(err)
                            }
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> No facturarle este mes
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="sticky bottom-[calc(var(--alto-barra)+0.75rem)] z-10 md:bottom-4">
            <Button
              className="h-12 w-full text-base shadow-lg"
              onClick={() => void emitir(elegidas, "varias")}
              disabled={!elegidas.length || !!busy}
            >
              {busy === "varias" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {elegidas.length ? `Emitir a ${elegidas.length} · ${formatARS(totalSel)}` : "Tildá a quién emitirle"}
            </Button>
          </div>
        </>
      )}
      <PagoParcialDialog
        f={parcial ? parcial.doc ?? parcial.f : null}
        onClose={() => setParcial(null)}
        onConfirmar={async (monto, medio) => {
          if (!parcial) return;
          try {
            const f = await asegurarDoc(parcial);
            const r = await registrarPago(f, monto, medio, user?.uid ?? "");
            toast.success(r.completa ? `${f.cliente}: completó el pago` : `${f.cliente}: pagó ${formatARS(monto)} · falta ${formatARS(r.saldo)}`);
          } catch (e) {
            err(e);
            throw e;
          }
        }}
      />
      {anuladas.length > 0 && (
        <div className="rounded-2xl border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">No se les factura este mes</p>
          {anuladas.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span>{f.cliente}</span>
              <Button size="sm" variant="ghost" onClick={() => void reactivarFactura(f).then(() => toast.success("Vuelve a la lista para emitir")).catch(err)}>
                Volver a facturar
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PasoCobrar({ lista, hoy, cobro, onVer }: { lista: FacturaDoc[]; hoy: string; cobro: typeof DATOS_COBRO_DEFAULT; onVer: (f: FacturaDoc) => void }) {
  const { user } = useUserProfileContext();
  const [parcial, setParcial] = useState<FacturaDoc | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => setSel((prev) => new Set([...prev].filter((id) => lista.some((f) => f.id === id)))), [lista]);
  const elegidas = lista.filter((f) => sel.has(f.id));
  const cobrar = async (fs: FacturaDoc[], medio: MedioCobro) => {
    try {
      for (const f of fs) await marcarCobrada(f, medio);
      toast.success(fs.length === 1 ? "Marcada como cobrada" : `${fs.length} marcadas como cobradas`);
      setSel(new Set());
    } catch (e) {
      err(e);
    }
  };
  if (!lista.length) return <Vacio texto="No hay nada por cobrar 🙌" />;
  const dialogoParcial = (
    <PagoParcialDialog
      f={parcial}
      onClose={() => setParcial(null)}
      onConfirmar={async (monto, medio) => {
        if (!parcial) return;
        try {
          const r = await registrarPago(parcial, monto, medio, user?.uid ?? "");
          toast.success(r.completa ? `${parcial.cliente}: completó el pago` : `${parcial.cliente}: pagó ${formatARS(monto)} · falta ${formatARS(r.saldo)}`);
        } catch (e) {
          err(e);
          throw e;
        }
      }}
    />
  );
  return (
    <div className="space-y-3">
      {dialogoParcial}
      <Ayuda>
        Cuando te paguen, tocá <b>Cobrada</b>. Las vencidas van primero, con el interés a hoy.
      </Ayuda>
      <Seleccion lista={lista} sel={sel} setSel={setSel}>
        {elegidas.length > 0 && <MenuCobrar label={`Cobradas (${elegidas.length})`} onElegir={(m) => void cobrar(elegidas, m)} />}
      </Seleccion>
      {lista.map((f, i) => {
        const vencida = f.vencimiento < hoy;
        const mora = textoMora(f, hoy);
        return (
          <Fila
            key={f.id}
            f={f}
            i={i}
            marcada={sel.has(f.id)}
            onMarcar={() => toggle(setSel, f.id)}
            alerta={vencida}
            extra={
              <span className={cn("text-[11px]", vencida ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {vencida ? <AlertTriangle className="mr-1 inline h-3 w-3" /> : null}
                {vencida ? "Venció" : "Vence"} el {f.vencimiento.split("-").reverse().slice(0, 2).join("/")}
                {mora ? <span className="block">{mora}</span> : null}
                {f.pagos?.length ? (
                  <span className="block font-medium text-emerald-700 dark:text-emerald-400">
                    Pagó {formatARS(pagadoDe(f))} a cuenta · falta {formatARS(saldoDe(f))}
                  </span>
                ) : null}
                {(f as FacturaDoc & { mail_enviado_at?: string }).mail_enviado_at ? (
                  <span className="ml-2 text-muted-foreground">
                    <Mail className="mr-0.5 inline h-3 w-3" /> mail enviado
                  </span>
                ) : null}
              </span>
            }
          >
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => onVer(f)}>
              <Eye className="mr-1 h-3.5 w-3.5" /> Ver
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => void navigator.clipboard.writeText(textoCobro(f, cobro)).then(() => toast.success("Recordatorio copiado"), () => toast.error("No se pudo copiar"))}
              title="Copiar el texto del recordatorio de pago"
            >
              <Copy className="mr-1 h-3.5 w-3.5" /> Recordatorio
            </Button>
            <MenuCobrar label="Cobrada" onElegir={(m) => void cobrar([f], m)} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Más opciones">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setParcial(f)}>
                  <Banknote className="mr-2 h-4 w-4" /> Pagó una parte…
                </DropdownMenuItem>
                {/* Nunca se le mandó (p. ej. se registró un pago en el mes equivocado y se deshizo): vuelve a Emitir. */}
                {!f.emitida_por && (
                  <DropdownMenuItem onClick={() => void volverASinEmitir(f).then(() => toast.success(`${f.cliente}: vuelve a «Emitir»`)).catch(err)}>
                    <Undo2 className="mr-2 h-4 w-4" /> Volver a «Emitir» (no se la mandé)
                  </DropdownMenuItem>
                )}
                {!f.arca?.cae && (
                  <DropdownMenuItem className="text-destructive" onClick={() => void anularFactura(f).then(() => toast.success("No se le factura este mes")).catch(err)}>
                    <Trash2 className="mr-2 h-4 w-4" /> No facturarle este mes
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </Fila>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
  set((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

function Seleccion({
  lista,
  sel,
  setSel,
  children,
}: {
  lista: FacturaDoc[];
  sel: Set<string>;
  setSel: React.Dispatch<React.SetStateAction<Set<string>>>;
  children?: ReactNode;
}) {
  const todas = lista.length > 0 && lista.every((f) => sel.has(f.id));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground">
        <Checkbox checked={todas} onCheckedChange={() => setSel(todas ? new Set() : new Set(lista.map((f) => f.id)))} aria-label="Seleccionar todas" />
        {todas ? "Quitar selección" : `Seleccionar todas (${lista.length})`}
      </label>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function MenuCobrar({ label, onElegir }: { label: string; onElegir: (m: MedioCobro) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-600/90">
          <Banknote className="mr-1.5 h-3.5 w-3.5" /> {label} <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>¿Cómo pagó?</DropdownMenuLabel>
        {MEDIOS.filter((m) => m.value !== "adelantado").map((m) => (
          <DropdownMenuItem key={m.value} onClick={() => onElegir(m.value)}>
            {m.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Fila({
  f,
  i,
  marcada,
  onMarcar,
  alerta,
  extra,
  children,
}: {
  f: FacturaDoc;
  i: number;
  marcada: boolean;
  onMarcar: () => void;
  alerta?: boolean;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const { clienteById } = useRedes();
  return (
    <div
      style={{ animationDelay: `${i * 30}ms` }}
      className={cn(
        "rounded-xl border bg-card p-3 transition-colors animate-in fade-in slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none",
        alerta && "border-destructive/40",
        marcada && "border-primary bg-primary/[0.05]"
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox checked={marcada} onCheckedChange={onMarcar} className="mt-1" aria-label={`Seleccionar ${f.cliente}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ClienteTag cliente={clienteById(f.proyecto_id)} size="md" className="font-semibold text-foreground" />
            <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{f.tipo}</span>
            {f.debito && <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">Débito automático</span>}
            <span className="ml-auto font-bold tabular-nums">{formatARS(f.bruto)}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {f.items.map((x) => x.concepto).join(" + ") || "Sin ítems: tocá Editar"}
            {f.iva ? ` · IVA ${f.iva_pct}%` : ""}
          </p>
          {extra && <div className="mt-0.5">{extra}</div>}
          <div className="mt-2 flex flex-wrap items-center justify-end gap-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Ayuda({ children }: { children: ReactNode }) {
  return <p className="px-1 text-xs text-muted-foreground">{children}</p>;
}

function Vacio({ texto, accion }: { texto: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{texto}</p>
      {accion}
    </div>
  );
}


