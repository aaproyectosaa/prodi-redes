import { CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRedes } from "@/contexts/redes-data-context";
import { mesAR } from "@/lib/fecha";
import { DIA_PAGO_DESDE, DIA_VENCIMIENTO, diaPago } from "@/lib/redes/facturacion";
import { mesLabel, sumarMeses } from "@/lib/redes/format";
import { errorPlazo } from "@/lib/redes/plazoPago";

const nombre = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();
const NADA = "nada";

/**
 * "Cuándo paga": deja explícito el calendario (mes vencido: el 27 se le factura ese mes y lo paga del
 * 1 al 5 del siguiente), los días de pago propios del cliente y hasta qué mes tiene pagado.
 */
export function PlazoPago({
  desde,
  hasta,
  onChange,
  adelantado,
  onAdelantado,
}: {
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
      <p className="text-xs text-muted-foreground">
        Mes vencido: el 27 de cada mes se le factura ese mes y lo paga del {d} al {h} del mes siguiente. La de {nombre(mes)} se arma el
        27/{mm} y se paga <b>del {d} al {h} de {nombre(sig)}</b>; desde el {h + 1} corre un 0,5% de interés por día.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Paga del día</span>
        <Input inputMode="numeric" className="h-9 w-14 text-center" value={desde} placeholder={String(DIA_PAGO_DESDE)} onChange={(e) => onChange({ desde: soloDia(e.target.value), hasta })} />
        <span>al</span>
        <Input inputMode="numeric" className="h-9 w-14 text-center" value={hasta} placeholder={String(diaDefecto)} onChange={(e) => onChange({ desde, hasta: soloDia(e.target.value) })} />
        <span>del mes siguiente</span>
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
            <SelectItem value={NADA}>Nada por adelantado (paga mes a mes)</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m}>
                {mesLabel(m)} (servicio de {nombre(m)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {pagado
            ? pagado < mes
              ? `Ya se le terminó: la de ${nombre(mes)} se le factura normal.`
              : `Las boletas hasta la de ${nombre(pagado)} (incluida) salen como cobradas; la de ${nombre(sumarMeses(pagado, 1))} se le factura normal.`
            : `Si pagó un plan trimestral o anual. Ej.: si pagó hasta ${nombre(sumarMeses(mes, 2))}, las boletas de ${nombre(mes)}, ${nombre(sig)} y ${nombre(sumarMeses(mes, 2))} salen como cobradas.`}
        </p>
      </div>
    </div>
  );
}
