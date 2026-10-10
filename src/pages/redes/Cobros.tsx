import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  Check,
  ChevronDown,
  Eye,
  FileSpreadsheet,
  Loader2,
  Mail,
  Copy,
  MoreHorizontal,
  Pencil,
  Receipt,
  Send,
  Trash2,
  Undo2,
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
type Paso = 1 | 2;

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
      const clave = `${f.id}:${abono}:${JSON.stringify(c?.facturacion ?? null)}`;
      if (!c || sincronizadas.current.has(clave)) continue;
      sincronizadas.current.add(clave);
      void sincronizarBorrador(f, c, abono, settings.iva_pct ?? 21).catch((e) => console.warn("[cobros] sincronizar", f.id, e));
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
      const plan = planDe(c, planes);
      if (!plan.precioMensual) continue;
      const f = armarFactura(
        { id: c.id, nombre: c.nombre, abono: plan.precioMensual, planNombre: plan.nombre, facturacion: c.facturacion ?? null, debitoActivo: c.suscripcion?.estado === "activa" },
        mes,
        { ivaPct, diaVencimiento: dia, por: "", hoy }
      );
      filas.push({ pid: c.id, f });
    }
    return filas.sort((a, b) => a.f.cliente.localeCompare(b.f.cliente));
  }, [borradores, clientes, facturas, planes, settings.iva_pct, settings.dia_vencimiento, mes, hoy]);

  const sugerido: Paso = !porEmitir.length && pendientes.length ? 2 : 1;
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

  const pasos: { n: Paso; titulo: string; detalle: string; listo: boolean }[] = [
    {
      n: 1,
      titulo: "Emitir",
      detalle: porEmitir.length ? `${porEmitir.length} sin emitir` : vivas.length ? "Todas emitidas" : "—",
      listo: vivas.length > 0 && porEmitir.length === 0,
    },
    {
      n: 2,
      titulo: "Cobrar",
      detalle: pendientes.length ? `${pendientes.length} por cobrar` : cobradas.length ? "Todo cobrado" : "—",
      listo: vivas.length > 0 && pendientes.length === 0 && porEmitir.length === 0,
    },
  ];

  return (
    <PageShell
      title="Cobros a clientes"
      subtitle={`Mes vencido: el 27 de ${mesLabel(mes).split(" ")[0].toLowerCase()} se emiten las boletas de ${mesLabel(periodoDe(mes)).split(" ")[0].toLowerCase()} y se pagan del 1 al ${settings.dia_vencimiento ?? DIA_VENCIMIENTO} de ${mesLabel(sumarMeses(mes, 1)).toLowerCase()} (salvo los clientes con otro plazo). A los de mes adelantado se les factura ${mesLabel(sumarMeses(mes, 1)).split(" ")[0].toLowerCase()}. Después corre un 0,5% de interés por día.`}
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
          {total > 0 && (
            <div className="rounded-2xl border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span>
                  Cobrado <b className="text-lg tabular-nums">{formatARS(cobrado)}</b> <span className="text-muted-foreground">de {formatARS(total)} emitidos</span>
                </span>
                <span className="text-muted-foreground">Falta {formatARS(total - cobrado)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${Math.round((cobrado / total) * 100)}%` }} />
              </div>
            </div>
          )}

          <ol className="grid grid-cols-2 gap-2">
            {pasos.map((p) => (
              <li key={p.n}>
                <button
                  type="button"
                  onClick={() => ir(p.n)}
                  aria-current={paso === p.n ? "step" : undefined}
                  className={cn(
                    "flex h-full w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all",
                    paso === p.n ? "border-primary bg-primary/[0.07] shadow-sm" : "hover:border-primary/40"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                      p.listo ? "bg-emerald-500 text-white" : paso === p.n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {p.listo ? <Check className="h-4 w-4" /> : p.n}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">{p.titulo}</span>
                    <span className="block text-[11px] text-muted-foreground">{p.detalle}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div key={`${mes}-${paso}`} className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
            {paso === 1 && (
              <PasoEmitir
                mes={mes}
                lista={porEmitir}
                anuladas={anuladas}
                onVer={abrir}
                onEditar={(r) => void editarFila(r)}
                editando={editarPid}
                onDatos={setDatosDe}
                onEmitidas={() => ir(2)}
              />
            )}
            {paso === 2 && <PasoCobrar lista={pendientes} hoy={hoy} cobro={cobro} onVer={abrir} />}
          </div>

          {cobradas.length > 0 && (
            <details className="rounded-2xl border bg-card px-4 py-3">
              <summary className="cursor-pointer select-none text-sm font-semibold">
                Cobradas ({cobradas.length}) · {formatARS(cobrado)}
              </summary>
              <div className="mt-3 divide-y">
                {cobradas.map((f) => (
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
            </details>
          )}
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
            Tildá a quién le querés emitir la boleta de {mesLabel(periodoDe(mes)).toLowerCase()} y tocá <b>Emitir</b>. Le llega a su panel con un aviso y una copia por mail. Tocá <b>Ver</b> para mirarla antes.
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
                          {r.doc && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => void anularFactura(r.doc!).then(() => toast.success("No se le factura este mes")).catch(err)}>
                                <Trash2 className="mr-2 h-4 w-4" /> No facturarle este mes
                              </DropdownMenuItem>
                            </>
                          )}
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
        Cuando te paguen, tocá <b>Cobrada</b> y elegí cómo pagó. Las vencidas aparecen primero, con el interés del 0,5% por día a hoy (queda
        guardado lo que se cobró al marcarla). A los que deben les mandamos un recordatorio solo (2 días antes y a los 1, 7 y 15 días de vencida).
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
  return <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">{children}</p>;
}

function Vacio({ texto, accion }: { texto: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{texto}</p>
      {accion}
    </div>
  );
}


