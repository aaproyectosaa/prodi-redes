import { CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRedes } from "@/contexts/redes-data-context";
import { mesAR } from "@/lib/fecha";
import { DIA_PAGO_DESDE, DIA_VENCIMIENTO, diaPago, periodoDe, type ModoCobro } from "@/lib/redes/facturacion";
import { mesLabel, sumarMeses } from "@/lib/redes/format";
import { errorPlazo } from "@/lib/redes/plazoPago";
import { cn } from "@/lib/utils";

const nombre = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();
const NADA = "nada";

const MODOS: { value: ModoCobro; label: string; desc: string }[] = [
  { value: "vencido", label: "Mes vencido", desc: "El 27 se factura ese mes" },
  { value: "adelantado", label: "Mes adelantado", desc: "El 27 se factura el que viene" },
];

/**
 * "Cuándo paga": si paga a mes vencido (lo normal: el 27 se le factura ese mes) o a mes adelantado (el
 * 27 se le factura el mes que viene), los días de pago (del 1 al 5 del mes siguiente, o los suyos) y
 * hasta qué mes tiene pagado.
 */
export function PlazoPago({
  modo,
  onModo,
  desde,
  hasta,
  onChange,
  adelantado,
  onAdelantado,
}: {
  modo: ModoCobro;
  onModo: (m: ModoCobro) => void;
  desde: string;
  hasta: string;
  onChange: (v: { desde: string; hasta: string }) => void;
  /** Último mes de servicio pagado por adelantado (YYYY-MM) o "". */
  adelantado: string;
  onAdelantado: (mes: string) => void;
}) {
  const { settings } = useRedes();
  const diaDefecto = settings.dia_vencimiento ?? DIA_VENCIMIENTO;
  const d = diaPago(desde) ?? DIA_PAGO_DESDE;
  const h = diaPago(hasta) ?? diaDefecto;
  const propio = !!(diaPago(desde) || diaPago(hasta));
  const error = errorPlazo(desde, hasta, diaDefecto);
  const mes = mesAR();
  const sig = sumarMeses(mes, 1);
  const mm = mes.slice(5);
  // La boleta que se arma este 27 (el mes del servicio).
  const proxima = periodoDe(mes, modo);
  const soloDia = (s: string) => s.replace(/\D/g, "").slice(0, 2);
  // Meses de servicio para elegir: desde el anterior hasta dentro de un año (y el guardado, si quedó afuera).
  const meses = Array.from({ length: 14 }, (_, i) => sumarMeses(mes, i - 1));
  if (/^\d{4}-\d{2}$/.test(adelantado) && !meses.includes(adelantado)) meses.unshift(adelantado);
  const pagado = /^\d{4}-\d{2}$/.test(adelantado) ? adelantado : "";
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Cuándo paga</span>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1">
        {MODOS.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => onModo(m.value)}
            className={cn("rounded-lg px-2 py-1.5 text-left transition-all", modo === m.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground")}
          >
            <span className="block text-sm font-medium">{m.label}</span>
            <span className={cn("block text-[11px]", modo === m.value ? "text-primary-foreground/80" : "text-muted-foreground")}>{m.desc}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {modo === "adelantado"
          ? `Mes adelantado: el 27 de cada mes se le factura el mes que viene, y lo paga al empezar ese mes. El 27/${mm} se le arma la de ${nombre(sig)} y se paga `
          : `Mes vencido: el 27 de cada mes se le factura ese mes, ya trabajado, y lo paga el mes siguiente. El 27/${mm} se le arma la de ${nombre(mes)} y se paga `}
        <b>
          del {d} al {h} de {nombre(sig)}
        </b>
        ; desde el {h + 1} corre un 0,5% de interés por día.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Paga del día</span>
        <Input inputMode="numeric" className="h-9 w-14 text-center" value={desde} placeholder={String(DIA_PAGO_DESDE)} onChange={(e) => onChange({ desde: soloDia(e.target.value), hasta })} />
        <span>al</span>
        <Input inputMode="numeric" className="h-9 w-14 text-center" value={hasta} placeholder={String(diaDefecto)} onChange={(e) => onChange({ desde, hasta: soloDia(e.target.value) })} />
        <span>del mes siguiente al 27</span>
        {propio && (
          <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => onChange({ desde: "", hasta: "" })}>
            Volver al {DIA_PAGO_DESDE} al {diaDefecto}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="space-y-1">
        <Label className="text-xs">Tiene pagado hasta</Label>
        <Select value={pagado || NADA} onValueChange={(v) => onAdelantado(v === NADA ? "" : v)}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NADA}>Nada pagado de antemano (paga mes a mes)</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m}>
                {mesLabel(m)} (servicio de {nombre(m)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {pagado
            ? pagado < proxima
              ? `Ya se le terminó: la de ${nombre(proxima)} se le factura normal.`
              : `Las boletas hasta la de ${nombre(pagado)} (incluida) salen como cobradas; la de ${nombre(sumarMeses(pagado, 1))} se le factura normal.`
            : `Si pagó un plan trimestral o anual. Ej.: si pagó hasta ${nombre(sumarMeses(proxima, 2))}, las boletas de ${nombre(proxima)}, ${nombre(sumarMeses(proxima, 1))} y ${nombre(sumarMeses(proxima, 2))} salen como cobradas.`}
        </p>
      </div>
    </div>
  );
}
