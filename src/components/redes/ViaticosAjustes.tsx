// Ajustes → Viáticos de filmación. Cada localidad tiene su precio: salida + $ por km (redondeado), así
// Guadalupe Norte (24 km) no sale lo mismo que Vera (66 km). A cualquiera se le puede poner un precio a mano.

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatARS } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import type { MontosViatico } from "../../../api/_lib/viaticos";
import { LOCALIDAD_BASE, LOCALIDADES, SIN_CARGO_KM, VIATICO_SUGERIDO, precioPorDistancia } from "../../../api/_lib/viaticos";

const soloNumero = (s: string) => s.replace(/\D/g, "").slice(0, 9);
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function ViaticosAjustes({
  actual,
  promo,
  onGuardar,
}: {
  actual: MontosViatico | undefined;
  /** Promo (%) desde el 2º video extra de la misma filmación. */
  promo: number;
  onGuardar: (v: MontosViatico, promo: number) => Promise<void>;
}) {
  const [promoTxt, setPromoTxt] = useState(String(promo));
  useEffect(() => setPromoTxt(String(promo)), [promo]);
  const [salida, setSalida] = useState("");
  const [porKm, setPorKm] = useState("");
  const [propios, setPropios] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setSalida(String(actual?.salida ?? VIATICO_SUGERIDO.salida));
    setPorKm(String(actual?.por_km ?? VIATICO_SUGERIDO.por_km));
    setPropios(Object.fromEntries(Object.entries(actual?.por_localidad ?? {}).map(([k, v]) => [k, v ? String(v) : ""])));
  }, [actual]);

  const montos: MontosViatico = { salida: Number(salida) || 0, por_km: Number(porKm) || 0 };
  const filas = useMemo(() => LOCALIDADES.filter((l) => l.n !== LOCALIDAD_BASE && (!q.trim() || norm(l.n).includes(norm(q.trim())))), [q]);
  const aMano = Object.values(propios).filter((v) => Number(v) > 0).length;
  const ejemplo = (km: number) => formatARS(precioPorDistancia(montos, km));

  const guardar = async () => {
    setGuardando(true);
    try {
      const por_localidad = Object.fromEntries(
        Object.entries(propios)
          .map(([k, v]) => [k, Number(v) || 0] as const)
          .filter(([, v]) => v > 0)
      );
      await onGuardar({ salida: Number(salida) || 0, por_km: Number(porKm) || 0, por_localidad }, Math.min(50, Number(promoTxt) || 0));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      {/* La cuenta */}
      <div className="space-y-2">
        <Label>Cómo se calcula</Label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="relative w-32">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input inputMode="numeric" className="pl-7 tabular-nums" value={salida} onChange={(e) => setSalida(soloNumero(e.target.value))} aria-label="Salida" />
          </div>
          <span className="text-muted-foreground">de salida +</span>
          <div className="relative w-28">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input inputMode="numeric" className="pl-7 tabular-nums" value={porKm} onChange={(e) => setPorKm(soloNumero(e.target.value))} aria-label="Por km" />
          </div>
          <span className="text-muted-foreground">por km</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Ej.: Guadalupe Norte (24 km) {ejemplo(24)} · Malabrigo (39 km) {ejemplo(39)} · Vera (66 km) {ejemplo(66)} · Las Toscas (95 km) {ejemplo(95)}.
          Redondeado a $500. Sugerido: {formatARS(VIATICO_SUGERIDO.salida)} + {formatARS(VIATICO_SUGERIDO.por_km)} por km.
        </p>
      </div>

      {/* Cada localidad */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Precio de cada localidad</Label>
          <span className="text-[11px] text-muted-foreground">{aMano ? `${aMano} con precio a mano` : "todas por la cuenta"}</span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar localidad" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-h-96 divide-y overflow-y-auto rounded-xl border">
          {filas.map((l) => {
            const rio = l.p !== "Santa Fe";
            const cerca = l.km <= SIN_CARGO_KM;
            const sugerido = rio ? "A coordinar" : cerca ? "Sin cargo" : l.km > 100 ? "A coordinar" : formatARS(precioPorDistancia(montos, l.km));
            const manual = Number(propios[l.n]) > 0;
            return (
              <div key={`${l.p}-${l.n}`} className="px-3 py-2">
                <p className="truncate text-sm font-medium" title={l.n}>
                  {l.n}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-[11px] leading-tight text-muted-foreground">
                    {l.km} km{rio ? ` · ${l.p}, cruzando el río` : cerca ? " · alrededores" : ""}
                    {manual ? ` · por la cuenta: ${sugerido}` : ""}
                  </p>
                  <div className="relative w-28 shrink-0">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <Input
                      inputMode="numeric"
                      className={cn("h-8 pl-6 text-right text-sm tabular-nums placeholder:text-foreground/70", manual && "border-primary/60 bg-primary/[0.05]")}
                      placeholder={sugerido.replace("$", "").trim()}
                      value={propios[l.n] ?? ""}
                      onChange={(e) => setPropios((p) => ({ ...p, [l.n]: soloNumero(e.target.value) }))}
                      aria-label={`Precio para ${l.n}`}
                    />
                  </div>
                  {manual && (
                    <button
                      type="button"
                      onClick={() => setPropios((p) => ({ ...p, [l.n]: "" }))}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                      title="Volver a la cuenta"
                      aria-label="Volver a la cuenta"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {filas.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No hay localidades con ese nombre.</p>}
        </div>
        <p className="text-[11px] text-muted-foreground">
          En gris, lo que sale por la cuenta; escribí un número para ponerle otro precio. Reconquista siempre sin cargo. Las de Corrientes y las de más de
          100 km se coordinan por chat (salvo que les pongas precio). Distancias en línea recta (Georef).
        </p>
      </div>

      {/* Varios videos juntos */}
      <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3">
        <Label>Varios videos en la misma filmación</Label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Desde el 2º video extra,</span>
          <div className="relative w-20">
            <Input inputMode="numeric" className="pr-6 text-right tabular-nums" value={promoTxt} onChange={(e) => setPromoTxt(soloNumero(e.target.value).slice(0, 2))} aria-label="Promo %" />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
          </div>
          <span className="text-muted-foreground">menos</span>
        </div>
        <p className="text-[11px] text-muted-foreground">El cliente pide varios videos para filmar el mismo día: paga un solo viaje y los extra desde el 2º tienen este descuento (0 = sin promo).</p>
      </div>

      <Button className="w-full" onClick={() => void guardar()} disabled={guardando}>
        {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Guardar viáticos
      </Button>
    </div>
  );
}
