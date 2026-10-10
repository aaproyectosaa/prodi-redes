import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CircleDollarSign,
  Clapperboard,
  Image as ImageIcon,
  Lightbulb,
  PiggyBank,
  Receipt,
  ShoppingBag,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell, Section, StatCard } from "@/components/redes/PageShell";
import { ClienteTag } from "@/components/redes/ClienteTag";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { diaAR, mesAR } from "@/lib/fecha";
import { formatARS, formatNum, hace, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { planDe, usoPlan } from "@/lib/redes/planes";
import { formatoInfo } from "@/lib/redes/piezas";
import {
  ESTADO_FACTURA,
  UNIDAD_POR_ROL,
  calcularPago,
  interesMora,
  nombrePeriodo,
  unidadesDelMes,
  useConfigPagos,
  trabajosDelMes,
  useFacturas,
  useGastos,
  useLiquidaciones,
  useObligaciones,
  cuotasDelMes,
} from "@/lib/redes/facturacion";
import { EstadisticasAnio } from "@/components/redes/admin/EstadisticasAnio";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { cn } from "@/lib/utils";

/**
 * Tablero del dueño: plata, crecimiento, pedidos y equipo. La producción (videos, rodajes,
 * piezas) queda en su menú; acá solo lo que sirve para decidir.
 */
export default function Tablero() {
  const navigate = useNavigate();
  const { clientes, videos, planes, cobros, piezas } = useRedes();
  const { profiles } = useAppData();
  const mes = mesActual();
  const hoy = hoyISO();
  const dia = diaAR();
  const desde = sumarMeses(mes, -11);
  const { facturas } = useFacturas(desde);
  const cfgPagos = useConfigPagos();
  const liqs = useLiquidaciones(mes);
  const gastosMes = useGastos(mes).filter((g) => g.mes === mes).reduce((a, g) => a + g.monto, 0);
  const { role } = useUserProfileContext();
  const esAdmin = role === "admin";

  // Abonos según los planes (lo que se va a facturar el 27).
  const mrr = clientes.reduce((a, c) => a + planDe(c, planes).precioMensual, 0);
  const extrasDe = (m: string) =>
    cobros.filter((c) => c.tipo !== "abono" && c.estado === "aprobado" && mesAR(c.pagado_at ?? c.created_at) === m);

  // Ingresos por mes: lo facturado (sin anuladas) + extras cobrados por Mercado Pago. En neto, igual
  // que en EstadisticasAnio: el IVA de las boletas no es de PRODI (y el estimado con el abono ya es neto).
  const meses = useMemo(() => Array.from({ length: 12 }, (_, i) => sumarMeses(desde, i)), [desde]);
  const serie = meses.map((m) => {
    const fs = facturas.filter((f) => f.mes === m && f.estado !== "anulada");
    const extras = extrasDe(m).reduce((a, c) => a + c.monto, 0);
    const estimado = fs.length === 0 && m === mes;
    const facturado = estimado ? mrr : fs.reduce((a, f) => a + f.neto, 0);
    return { m, total: facturado + extras, estimado, clientes: estimado ? clientes.length : new Set(fs.map((f) => f.proyecto_id)).size };
  });
  const actual = serie[serie.length - 1];
  const anterior = serie[serie.length - 2];
  const crec = anterior?.total ? Math.round(((actual.total - anterior.total) / anterior.total) * 100) : null;

  const delMes = facturas.filter((f) => f.mes === mes && f.estado !== "anulada");
  const extrasMes = extrasDe(mes).reduce((a, c) => a + c.monto, 0);
  // Cobrado: todo lo que entró por Mercado Pago (abonos debitados, sin la comisión de MP, y extras) + boletas cobradas por otros medios.
  const porMP = cobros.filter((c) => c.estado === "aprobado" && mesAR(c.pagado_at ?? c.created_at) === mes).reduce((a, c) => a + c.monto - (Number(c.comision_mp) || 0), 0);
  const cobrado = porMP + delMes.filter((f) => f.estado === "cobrada" && f.medio !== "mercadopago").reduce((a, f) => a + f.bruto, 0);
  const vencidas = facturas.filter((f) => f.estado === "pendiente" && f.vencimiento < hoy);

  // Equipo: lo que corresponde pagar este mes.
  const equipo = profiles
    .filter((p) => ["productor", "editor", "pauta", "diseno"].includes(p.role ?? "") && p.activo !== false)
    .map((p) => {
      const trabajos = trabajosDelMes(p.id, p.role ?? "", mes, videos, piezas);
      const unidades = trabajos.length;
      const liq = liqs.find((l) => l.uid === p.id);
      const calc = calcularPago(cfgPagos[p.id], unidades, liq?.ajustes ?? [], clientes.map((c) => c.id), { mes, trabajos });
      return { p, unidades, porCliente: cfgPagos[p.id]?.modo === "por_cliente" ? calc.clientes : null, total: liq?.estado === "pagado" ? (liq.total_pagado ?? calc.total) : calc.total, pagado: liq?.estado === "pagado" };
    });
  const costoEquipo = equipo.reduce((a, e) => a + e.total, 0);
  const obligaciones = useObligaciones();
  const cuotasMes = cuotasDelMes(obligaciones, mes).reduce((a, v) => a + v.c.monto, 0);
  const margen = actual.total - costoEquipo - gastosMes - cuotasMes;

  // Pedidos que entraron este mes (videos que pidió el cliente, piezas y extras).
  type Pedido = { id: string; tipo: "video" | "pieza" | "extra"; clienteId: string; texto: string; monto: number | null; estado: string; at: string; ir: () => void };
  const pedidos: Pedido[] = [
    ...videos
      .filter((v) => v.pedido_cliente && mesAR(v.created_at) === mes)
      .map((v) => ({
        id: v.id,
        tipo: "video" as const,
        clienteId: v.proyecto_id,
        texto: v.titulo,
        monto: v.extra ? planDe(clientes.find((c) => c.id === v.proyecto_id), planes).precioVideoExtra : null,
        estado: v.extra ? "Extra pagado" : "Del plan",
        at: v.created_at,
        ir: () => navigate(`/videos?video=${v.id}`),
      })),
    ...piezas
      .filter((p) => mesAR(p.created_at) === mes && p.estado !== "cancelada")
      .map((p) => ({
        id: p.id,
        tipo: "pieza" as const,
        clienteId: p.proyecto_id,
        texto: `${formatoInfo(p.formato).label}: ${p.producto || p.pedido}`,
        monto: p.incluida ? null : p.precio,
        estado: p.incluida ? "Del plan" : p.estado === "pendiente_pago" ? "Sin pagar" : "Pagada",
        at: p.created_at,
        ir: () => navigate(`/piezas?pieza=${p.id}`),
      })),
    ...cobros
      .filter((c) => c.tipo === "video_extra" && c.estado === "aprobado" && mesAR(c.created_at) === mes && !(c as { pedido?: unknown }).pedido)
      .map((c) => ({
        id: c.id,
        tipo: "extra" as const,
        clienteId: c.proyecto_id,
        texto: c.concepto,
        monto: c.monto,
        estado: "Pagado",
        at: c.created_at,
        ir: () => navigate(`/clientes/${c.proyecto_id}?tab=informe`),
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const vendidoExtra = pedidos.reduce((a, p) => a + (p.estado === "Sin pagar" ? 0 : (p.monto ?? 0)), 0);

  // Clientes: abono, extras, leads y cómo está el cobro del mes.
  const filas = clientes
    .map((c) => {
      const plan = planDe(c, planes);
      const f = delMes.find((x) => x.proyecto_id === c.id);
      const publicados = videos.filter((v) => v.proyecto_id === c.id && v.mes === mes && v.etapa === "publicado");
      const leads = publicados.reduce((a, v) => a + (v.resultados?.mensajes ?? 0), 0);
      const leadsAnt = videos
        .filter((v) => v.proyecto_id === c.id && v.mes === sumarMeses(mes, -1) && v.etapa === "publicado")
        .reduce((a, v) => a + (v.resultados?.mensajes ?? 0), 0);
      const extras = extrasDe(mes).filter((x) => x.proyecto_id === c.id).reduce((a, x) => a + x.monto, 0);
      return { c, plan, f, leads, leadsAnt, extras };
    })
    .sort((a, b) => b.plan.precioMensual + b.extras - (a.plan.precioMensual + a.extras));

  // Ideas para vender más o no perder clientes.
  const oportunidades: { tipo: "venta" | "riesgo" | "dato"; texto: string; ir: string }[] = [];
  for (const { c, plan, leads, leadsAnt } of filas) {
    const uso = usoPlan(c, planes, videos, mes);
    if (uso.excedido > 0)
      oportunidades.push({ tipo: "venta", ir: `/clientes/${c.id}`, texto: `${c.nombre} pidió ${uso.excedido} video${uso.excedido === 1 ? "" : "s"} más que su plan: ofrecele el plan siguiente.` });
    else if (uso.cupo > 0 && uso.publicados >= uso.cupo)
      oportunidades.push({ tipo: "venta", ir: `/clientes/${c.id}`, texto: `${c.nombre} ya publicó todo su plan del mes: buen momento para ofrecer extras.` });
    if (leadsAnt >= 20 && leads < leadsAnt * 0.5 && dia >= 20)
      oportunidades.push({ tipo: "riesgo", ir: `/clientes/${c.id}?tab=resultados`, texto: `${c.nombre} viene con la mitad de mensajes que el mes pasado (${leads} vs ${leadsAnt}). Revisá la pauta antes de que lo note.` });
    if (dia >= 10 && uso.cupo > 0 && uso.usados < Math.ceil(uso.cupo / 2))
      oportunidades.push({ tipo: "riesgo", ir: `/clientes/${c.id}`, texto: `${c.nombre} tiene ${uso.usados} de ${uso.cupo} videos planificados y ya pasó el 10. Si no recibe lo que paga, se puede ir.` });
    if (plan.plan === null && !c.plan_redes_override?.precio_mensual)
      oportunidades.push({ tipo: "dato", ir: `/clientes/${c.id}?tab=config`, texto: `${c.nombre} no tiene plan: no se le factura el 27.` });
  }
  for (const f of vencidas.slice(0, 3))
    oportunidades.unshift({ tipo: "riesgo", ir: "/cobros", texto: `${f.cliente} tiene vencida la ${f.tipo} de ${nombrePeriodo(f)} (${formatARS(interesMora(f, hoy).totalConInteres)} con interés).` });

  const faltan27 = dia <= 27 ? 27 - dia : null;
  const paraRevisar = delMes.filter((f) => f.estado === "borrador").length;
  const faltaCobrar = delMes.filter((f) => f.estado === "pendiente").length;

  return (
    <PageShell title="Tablero" subtitle={`Cómo va el negocio · ${mesLabel(mes)}`}>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={actual.estimado ? "A facturar este mes" : "Facturado este mes"}
          value={formatARS(actual.total)}
          icon={CircleDollarSign}
          tone="primary"
          hint={
            crec === null ? `${clientes.length} clientes` : (
              <span className={cn("inline-flex items-center gap-0.5 font-medium", crec >= 0 ? "text-success" : "text-destructive")}>
                {crec >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {Math.abs(crec)}% vs {mesLabel(anterior.m).split(" ")[0].toLowerCase()}
              </span>
            )
          }
          onClick={() => navigate("/cobros")}
        />
        <StatCard
          label="Cobrado"
          value={formatARS(cobrado)}
          icon={Banknote}
          tone="success"
          hint={actual.total ? `Falta ${formatARS(Math.max(0, actual.total - cobrado))}` : undefined}
          onClick={() => navigate("/cobros")}
        />
        <StatCard label="Equipo" value={formatARS(costoEquipo)} icon={Users} hint={`${equipo.length} personas este mes`} onClick={() => navigate("/pagos-equipo")} />
        <StatCard
          label="Te queda"
          value={formatARS(margen)}
          icon={PiggyBank}
          tone={margen < 0 ? "danger" : "default"}
          hint={`Facturado − equipo − gastos (${formatARS(gastosMes)}) − cuotas e impuestos (${formatARS(cuotasMes)})`}
          onClick={() => navigate("/administracion")}
        />
      </div>

      <div className="mb-10">
        <EstadisticasAnio equipoActual={costoEquipo} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-8">
          <Section
            title="Clientes"
            description={`Lo que paga cada uno, los mensajes que le trajimos y cómo está el cobro del mes. Abonos: ${formatARS(mrr)} por mes, ${formatARS(clientes.length ? mrr / clientes.length : 0)} promedio por cliente.`}
            actions={
              esAdmin && (
                <Button variant="ghost" size="sm" onClick={() => navigate("/clientes")}>
                  Ver todos <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              )
            }
          >
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 text-right font-medium">Abono</th>
                    <th className="px-4 py-2 text-right font-medium">Extras del mes</th>
                    <th className="px-4 py-2 text-right font-medium">Mensajes</th>
                    <th className="px-4 py-2 text-right font-medium">Cobro del mes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filas.map(({ c, plan, f, leads, leadsAnt, extras }) => (
                    <tr key={c.id} className={cn(esAdmin && "cursor-pointer hover:bg-muted/40")} onClick={() => esAdmin && navigate(`/clientes/${c.id}`)}>
                      <td className="px-4 py-3">
                        <ClienteTag cliente={c} size="md" className="font-medium text-foreground" />
                        <p className="pl-3.5 text-xs text-muted-foreground">
                          {plan.nombre}
                          {c.suscripcion?.estado === "activa" ? " · débito automático" : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatARS(plan.precioMensual)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{extras ? formatARS(extras) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatNum(leads)}
                        {leadsAnt > 0 && <span className="block text-[10px] text-muted-foreground">{formatNum(leadsAnt)} el mes pasado</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {f ? (
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", ESTADO_FACTURA[f.estado].clase)}>
                            {f.estado === "pendiente" && f.vencimiento < hoy ? "Vencida" : ESTADO_FACTURA[f.estado].label}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">el 27</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filas.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Todavía no hay clientes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title="Pedidos que entraron"
            description={`Videos y piezas que pidieron los clientes este mes · ${formatARS(vendidoExtra)} vendidos aparte del abono`}
          >
            {pedidos.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Todavía no entraron pedidos este mes.</p>
            ) : (
              <div className="divide-y rounded-xl border bg-card">
                {pedidos.slice(0, 10).map((p) => {
                  const Icono = p.tipo === "pieza" ? ImageIcon : p.tipo === "video" ? Clapperboard : ShoppingBag;
                  return (
                    <button key={`${p.tipo}-${p.id}`} type="button" onClick={esAdmin ? p.ir : undefined} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/40">
                      <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.texto}</span>
                        <span className="block text-xs text-muted-foreground">
                          {clientes.find((c) => c.id === p.clienteId)?.nombre ?? "Cliente"} · {hace(p.at)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-medium tabular-nums">{p.monto ? formatARS(p.monto) : "—"}</span>
                        <span className={cn("block text-[11px]", p.estado === "Sin pagar" ? "text-warning" : "text-muted-foreground")}>{p.estado}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-8">
          <Section title="Facturación del 27">
            <button
              type="button"
              onClick={() => navigate("/cobros")}
              className="w-full space-y-2 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.10] to-transparent p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
            >
              <p className="flex items-center gap-2 font-semibold">
                <Receipt className="h-4 w-4 text-primary" />
                {delMes.length
                  ? paraRevisar
                    ? `${paraRevisar} boleta${paraRevisar === 1 ? "" : "s"} sin emitir`
                    : faltaCobrar
                      ? `${faltaCobrar} cliente${faltaCobrar === 1 ? "" : "s"} por cobrar`
                      : "Todo cobrado 🙌"
                  : faltan27 === 0
                    ? "Hoy es día de emitir las boletas"
                    : faltan27 !== null
                      ? `Faltan ${faltan27} día${faltan27 === 1 ? "" : "s"} para facturar`
                      : "Facturación del mes"}
              </p>
              <p className="text-sm text-muted-foreground">
                {delMes.length
                  ? `${formatARS(delMes.reduce((a, f) => a + f.bruto, 0))} facturados · ${formatARS(delMes.filter((f) => f.estado === "cobrada").reduce((a, f) => a + f.bruto, 0))} cobrados`
                  : `El 27 te avisamos para emitir las boletas (${formatARS(mrr)} en abonos). Vos elegís a quién.`}
              </p>
              {vencidas.length > 0 && (
                <p className="text-sm font-medium text-destructive">
                  {vencidas.length} vencida{vencidas.length === 1 ? "" : "s"} · {formatARS(vencidas.reduce((a, f) => a + f.bruto, 0))}
                </p>
              )}
            </button>
          </Section>

          <Section title="Para hacer crecer el negocio">
            {oportunidades.length === 0 ? (
              <p className="rounded-xl border p-4 text-sm text-muted-foreground">Todo en orden por ahora.</p>
            ) : (
              <div className="space-y-2">
                {oportunidades.slice(0, 6).map((o, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => navigate(esAdmin || o.ir.startsWith("/cobros") ? o.ir : "/cobros")}
                    className={cn(
                      "flex w-full gap-3 rounded-xl border p-3 text-left text-sm transition-colors hover:border-primary/50",
                      o.tipo === "venta" && "border-success/30 bg-success/[0.05]",
                      o.tipo === "riesgo" && "border-destructive/30 bg-destructive/[0.05]"
                    )}
                  >
                    <Lightbulb
                      className={cn("mt-0.5 h-4 w-4 shrink-0", o.tipo === "venta" ? "text-success" : o.tipo === "riesgo" ? "text-destructive" : "text-muted-foreground")}
                    />
                    <span>{o.texto}</span>
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Equipo este mes"
            description="Lo que hizo cada uno y lo que le corresponde cobrar."
            actions={
              <Button variant="ghost" size="sm" onClick={() => navigate("/pagos-equipo")}>
                Pagos <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            }
          >
            <div className="space-y-2">
              {equipo.map(({ p, unidades, porCliente, total, pagado }) => {
                const u = UNIDAD_POR_ROL[p.role ?? ""];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(esAdmin ? `/reportes/${p.id}` : "/pagos-equipo")}
                    className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/50"
                  >
                    <UserAvatar profile={p} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {porCliente !== null
                          ? `${porCliente} ${porCliente === 1 ? "cliente" : "clientes"} · ${unidades} ${u ? (unidades === 1 ? u.label : u.plural) : "trabajos"}`
                          : `${unidades} ${u ? (unidades === 1 ? u.label : u.plural) : "trabajos"}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{cfgPagos[p.id] ? formatARS(total) : "—"}</p>
                      <p className={cn("text-[11px]", pagado ? "text-success" : "text-muted-foreground")}>
                        {cfgPagos[p.id] ? (pagado ? "Pagado" : "A pagar") : "Sin cargar"}
                      </p>
                    </div>
                  </button>
                );
              })}
              {equipo.length === 0 && <p className="text-sm text-muted-foreground">Asigná roles al equipo en Equipo.</p>}
            </div>
          </Section>
        </div>
      </div>
    </PageShell>
  );
}
