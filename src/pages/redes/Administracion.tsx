import { useNavigate } from "react-router-dom";
import { FilaKpis, Kpi } from "@/components/redes/admin/AdminUI";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  FileSpreadsheet,
  HandCoins,
  Landmark,
  PiggyBank,
  Receipt,
  Send,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell, Section } from "@/components/redes/PageShell";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { diaAR, sumarDias } from "@/lib/fecha";
import { formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { planDe } from "@/lib/redes/planes";
import { useLibroMes } from "@/lib/redes/libro";
import {
  calcularPago,
  cuotasDelMes,
  deudaRestante,
  descargarLibro,
  periodoDe,
  unidadesDelMes,
  useConfigPagos,
  trabajosDelMes,
  useFacturas,
  useGastos,
  useLiquidaciones,
  useObligaciones,
  vencimientos,
} from "@/lib/redes/facturacion";
import { cn } from "@/lib/utils";

type Urgencia = "alta" | "media" | "info";
interface Tarea {
  id: string;
  urgencia: Urgencia;
  icono: React.ElementType;
  titulo: string;
  detalle: string;
  cta: string;
  ir: string;
}

const ddmm = (f: string) => f.slice(8, 10) + "/" + f.slice(5, 7);
const mesCorto = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();

/**
 * Inicio de administración: qué hay que hacer hoy y cómo viene el mes, con un toque para ir a cada cosa.
 */
export default function Administracion() {
  const navigate = useNavigate();
  const { profile } = useUserProfileContext();
  const { clientes, planes, videos, piezas } = useRedes();
  const { profiles } = useAppData();
  const mes = mesActual();
  const mesAnt = sumarMeses(mes, -1);
  const hoy = hoyISO();
  const dia = diaAR();
  const { facturas } = useFacturas(sumarMeses(mes, -6));
  const gastosTodos = useGastos(mesAnt);
  const liqs = useLiquidaciones(mesAnt);
  const cfg = useConfigPagos();
  const obligaciones = useObligaciones();
  const { libro, ingresos, egresos } = useLibroMes(mes);

  // ---- Cobros
  const delMes = facturas.filter((f) => f.mes === mes && f.estado !== "anulada");
  const borradores = delMes.filter((f) => f.estado === "borrador");
  const vencidas = facturas.filter((f) => f.estado === "pendiente" && f.vencimiento < hoy);
  const porCobrar = facturas.filter((f) => f.estado === "pendiente");
  const facturable = clientes.filter((c) => planDe(c, planes).precioMensual > 0 && !c.facturacion?.pausada);
  const faltan = facturable.filter((c) => !facturas.some((f) => f.mes === mes && f.proyecto_id === c.id));
  const totalMes = delMes.reduce((a, f) => a + f.bruto, 0);
  const cobradoMes = delMes.filter((f) => f.estado === "cobrada").reduce((a, f) => a + f.bruto, 0);

  // ---- Equipo
  const equipo = profiles.filter((p) => ["productor", "editor", "pauta", "diseno"].includes(p.role ?? "") && p.activo !== false);
  const pagoDe = (uid: string, role: string, m: string) => {
    const liq = liqs.find((l) => l.uid === uid && l.mes === m);
    if (liq?.estado === "pagado") return { pagado: true, monto: liq.total_pagado ?? 0 };
    const trabajos = trabajosDelMes(uid, role, m, videos, piezas);
    return { pagado: false, monto: calcularPago(cfg[uid], trabajos.length, liq?.ajustes ?? [], clientes.map((c) => c.id), { mes: m, trabajos }).total };
  };
  const debeAnt = equipo.filter((p) => !pagoDe(p.id, p.role ?? "", mesAnt).pagado && cfg[p.id]);
  const equipoMes = equipo.map((p) => pagoDe(p.id, p.role ?? "", mes));
  const equipoTotal = equipoMes.reduce((a, x) => a + x.monto, 0);
  const equipoPagado = equipoMes.filter((x) => x.pagado).reduce((a, x) => a + x.monto, 0);

  // ---- Gastos
  const gastos = gastosTodos.filter((g) => g.mes === mes);
  const faltanFijos = gastosTodos.filter((p) => p.mes === mesAnt && p.fijo && !gastos.some((g) => g.fijo && g.concepto === p.concepto));

  // ---- Deudas
  const proximas = vencimientos(obligaciones, sumarDias(hoy, 7));
  const vencDeudas = proximas.filter((v) => v.c.vence < hoy);
  const semana = proximas.filter((v) => v.c.vence >= hoy);
  const cuotasMes = cuotasDelMes(obligaciones, mes);
  const cuotasFalta = cuotasMes.filter((v) => !v.c.pagada).reduce((a, v) => a + v.c.monto, 0);

  const tareas: Tarea[] = [];
  if (vencDeudas.length)
    tareas.push({
      id: "deuda-vencida",
      urgencia: "alta",
      icono: AlertTriangle,
      titulo: vencDeudas.length === 1 ? `Se te venció ${vencDeudas[0].o.nombre}` : `Tenés ${vencDeudas.length} pagos vencidos (créditos e impuestos)`,
      detalle: `${formatARS(vencDeudas.reduce((a, v) => a + v.c.monto, 0))} sin pagar. Si ya lo pagaste, marcalo.`,
      cta: "Ver y pagar",
      ir: "/deudas",
    });
  if (vencidas.length)
    tareas.push({
      id: "cobros-vencidos",
      urgencia: "alta",
      icono: AlertTriangle,
      titulo: `${vencidas.length} ${vencidas.length === 1 ? "cliente tiene" : "clientes tienen"} la boleta vencida`,
      detalle: `${formatARS(vencidas.reduce((a, f) => a + f.bruto, 0))} · ${vencidas.slice(0, 3).map((f) => f.cliente).join(", ")}${vencidas.length > 3 ? "…" : ""}. Mandales un recordatorio.`,
      cta: "Recordar",
      ir: `/cobros?mes=${vencidas[0].mes}`,
    });
  const sinEmitir = faltan.length + borradores.length;
  if (sinEmitir && (delMes.length > 0 || dia >= 25))
    tareas.push({
      id: "emitir",
      urgencia: dia >= 27 ? "alta" : "media",
      icono: Send,
      // Las que se emiten el 27 de este mes cubren este mes (mes vencido).
      titulo: `Emitir las boletas de ${mesCorto(periodoDe(mes))} (${sinEmitir} sin emitir)`,
      detalle: dia >= 27 ? "Hoy es día de facturar. Elegís a quién y le llega a su panel y por mail." : `Se factura el 27. Faltan ${27 - dia} días.`,
      cta: "Emitir",
      ir: "/cobros",
    });
  semana.forEach((v) =>
    tareas.push({
      id: `vence-${v.o.id}-${v.c.n}`,
      urgencia: v.c.vence <= sumarDias(hoy, 3) ? "media" : "info",
      icono: CalendarClock,
      titulo: `${v.c.vence === hoy ? "Hoy vence" : `El ${ddmm(v.c.vence)} vence`} ${v.o.nombre}`,
      detalle: `${formatARS(v.c.monto)}${v.o.tipo === "impuesto" ? "" : ` · cuota ${v.c.n} de ${v.o.cuotas.length}`}`,
      cta: "Pagar",
      ir: `/deudas?id=${v.o.id}`,
    })
  );
  if (debeAnt.length)
    tareas.push({
      id: "equipo",
      urgencia: "media",
      icono: HandCoins,
      titulo: `Pagarle al equipo lo de ${mesCorto(mesAnt)}`,
      detalle: `Falta marcar a ${debeAnt.map((p) => p.nombre?.split(" ")[0]).join(", ")}.`,
      cta: "Ver pagos",
      ir: "/pagos-equipo",
    });
  if (faltanFijos.length)
    tareas.push({
      id: "fijos",
      urgencia: "info",
      icono: Copy,
      titulo: `Traer ${faltanFijos.length} gastos fijos de ${mesCorto(mesAnt)}`,
      detalle: faltanFijos.slice(0, 3).map((g) => g.concepto).join(", ") + (faltanFijos.length > 3 ? "…" : ""),
      cta: "Ir a gastos",
      ir: "/gastos",
    });
  const orden: Record<Urgencia, number> = { alta: 0, media: 1, info: 2 };
  tareas.sort((a, b) => orden[a.urgencia] - orden[b.urgencia]);

  const nombre = profile?.nombre?.split(" ")[0];
  const deben = porCobrar.reduce((a, f) => a + f.bruto, 0);
  const areas = [
    {
      titulo: "Cobros",
      icono: Receipt,
      color: "from-[#6F40FC] to-[#E040A0]",
      ir: "/cobros",
      // Lo que los clientes todavía deben (de cualquier mes); el avance es el de las boletas de este mes.
      valor: formatARS(deben),
      sub: porCobrar.length ? `por cobrar · ${porCobrar.length} boleta${porCobrar.length === 1 ? "" : "s"}` : "nada por cobrar",
      pct: totalMes ? cobradoMes / totalMes : null,
      extra: totalMes ? `Boletas de ${mesCorto(periodoDe(mes))}: ${formatARS(cobradoMes)} de ${formatARS(totalMes)}` : "Se factura el 27",
    },
    {
      titulo: "Pagos al equipo",
      icono: HandCoins,
      color: "from-sky-400 to-blue-600",
      ir: "/pagos-equipo",
      valor: formatARS(equipoTotal),
      sub: `a pagar en ${mesCorto(mes)}`,
      pct: equipoTotal ? equipoPagado / equipoTotal : null,
      extra: `${equipo.length} personas`,
    },
    {
      titulo: "Gastos",
      icono: Wallet,
      color: "from-amber-400 to-orange-500",
      ir: "/gastos",
      valor: formatARS(gastos.reduce((a, g) => a + g.monto, 0)),
      sub: `${gastos.length} cargados en ${mesCorto(mes)}`,
      pct: null,
      extra: null,
    },
    {
      titulo: "Deudas e impuestos",
      icono: Landmark,
      color: "from-red-500 to-rose-600",
      ir: "/deudas",
      valor: formatARS(cuotasFalta),
      sub: `para pagar en ${mesCorto(mes)}`,
      pct: null,
      extra: obligaciones.length ? `Deuda total ${formatARS(deudaRestante(obligaciones))}` : "Cargá créditos e impuestos",
    },
  ];

  return (
    <PageShell
      title={nombre ? `Hola, ${nombre}` : "Administración"}
      subtitle={`${mesLabel(mes)} · ${tareas.length ? `tenés ${tareas.length} ${tareas.length === 1 ? "cosa" : "cosas"} para hacer` : "todo al día"}`}
    >
      <div className="space-y-8">
        <div className="space-y-2">
          <FilaKpis>
            <Kpi icono={TrendingUp} label={`Entró en ${mesCorto(mes)}`} valor={formatARS(ingresos)} sub="Cobros y pagos que llegaron" tono="verde" />
            <Kpi icono={TrendingDown} label={`Salió en ${mesCorto(mes)}`} valor={formatARS(egresos)} sub="Gastos, equipo, cuotas e impuestos" tono="ambar" />
            <Kpi
              icono={PiggyBank}
              label="Quedó"
              valor={formatARS(ingresos - egresos)}
              sub={ingresos - egresos < 0 ? "Salió más de lo que entró" : "Entró menos lo que salió"}
              tono={ingresos - egresos < 0 ? "rojo" : "violeta"}
            />
            <Kpi icono={Clock} label="Te deben" valor={formatARS(deben)} sub={`${porCobrar.length} boleta${porCobrar.length === 1 ? "" : "s"} sin cobrar`} tono={vencidas.length ? "rojo" : "azul"} onClick={() => navigate("/cobros")} />
          </FilaKpis>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => descargarLibro(libro, mes)} disabled={!libro.length}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Libro para el contador (Excel)
            </Button>
          </div>
        </div>

        <Section title="Qué hacer ahora">
          {tareas.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" /> No hay nada pendiente. Todo cobrado, pagado y cargado.
            </div>
          ) : (
            <div className="grid gap-2">
              {tareas.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => navigate(t.ir)}
                  style={{ animationDelay: `${i * 40}ms` }}
                  className={cn(
                    "group flex items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors animate-in fade-in slide-in-from-bottom-1 fill-mode-both hover:border-primary/50 motion-reduce:animate-none sm:p-4",
                    t.urgencia === "alta" && "border-destructive/40 bg-destructive/[0.05]"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                      t.urgencia === "alta" ? "bg-destructive/15 text-destructive" : t.urgencia === "media" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <t.icono className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{t.detalle}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-sm font-medium text-primary sm:flex">
                    {t.cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Cada parte">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {areas.map((a) => (
              <button
                key={a.titulo}
                type="button"
                onClick={() => navigate(a.ir)}
                className="group flex flex-col gap-2 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <span className="flex items-center justify-between text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", a.color)}>
                      <a.icono className="h-4 w-4" />
                    </span>
                    {a.titulo}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span>
                  <span className="block text-2xl font-bold tabular-nums tracking-tight">{a.valor}</span>
                  <span className="block text-xs text-muted-foreground">{a.sub}</span>
                </span>
                {a.pct != null && (
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(a.pct * 100)}%` }} />
                  </span>
                )}
                {a.extra && <span className="text-xs text-muted-foreground">{a.extra}</span>}
              </button>
            ))}
          </div>
        </Section>

      </div>
    </PageShell>
  );
}
