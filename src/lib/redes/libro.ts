import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { fechaAR } from "@/lib/fecha";
import { sumarMeses } from "@/lib/redes/format";
import { cuotasPagadasDelMes, libroDelMes, useFacturas, useGastos, useLiquidaciones, useObligaciones } from "@/lib/redes/facturacion";

/** Libro del mes (ingresos y egresos) armado con todo lo que hay en el sistema. */
export function useLibroMes(mes: string) {
  const { cobros, clienteById } = useRedes();
  const { profiles } = useAppData();
  const { facturas } = useFacturas(sumarMeses(mes, -3));
  const gastos = useGastos(mes).filter((g) => g.mes === mes);
  const liqs = useLiquidaciones(mes);
  const obligaciones = useObligaciones();
  const libro = libroDelMes(mes, {
    facturas,
    cobrosMP: cobros
      .filter((c) => c.estado === "aprobado")
      .map((c) => ({ concepto: c.concepto, monto: c.monto, pagado_at: c.pagado_at, created_at: c.created_at, proyecto: clienteById(c.proyecto_id)?.nombre ?? "" })),
    gastos,
    pagosEquipo: liqs
      .filter((l) => l.mes === mes && l.estado === "pagado")
      .map((l) => ({
        nombre: profiles.find((p) => p.id === l.uid)?.nombre ?? "Equipo",
        monto: l.total_pagado ?? 0,
        fecha: l.pagado_at ? fechaAR(l.pagado_at) : `${mes}-28`,
        detalle: l.detalle,
      })),
    cuotas: cuotasPagadasDelMes(obligaciones, mes),
  });
  const ingresos = libro.filter((m) => m.tipo === "Ingreso").reduce((a, m) => a + m.monto, 0);
  const egresos = libro.filter((m) => m.tipo === "Egreso").reduce((a, m) => a + m.monto, 0);
  return { libro, ingresos, egresos };
}
