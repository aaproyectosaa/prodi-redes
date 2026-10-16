import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, PauseCircle, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Project } from "@/integrations/firebase/types";
import { formatARS } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import { leerConfigMora, subeDe, type ConfigMora } from "../../../api/_lib/mora-calc";

/** Ajustes: a partir de cuántos días de atraso entra en cada escalón (y si los escalones están activos). */
export function MoraAjustes({ actual, onGuardar }: { actual: Record<string, unknown> | undefined; onGuardar: (m: ConfigMora) => Promise<void> }) {
  const base = leerConfigMora({ mora: actual });
  const [m, setM] = useState(base);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setM(leerConfigMora({ mora: actual })), [actual]);
  const pasos: { k: "aviso" | "extras" | "pausa"; t: string; d: string; icono: React.ElementType; color: string }[] = [
    { k: "aviso", t: "En mora", d: "Lo ve el equipo en el panel y te avisamos.", icono: AlertTriangle, color: "text-orange-500" },
    { k: "extras", t: "Sin extras", d: "No puede pedir videos ni piezas pagos.", icono: ShieldOff, color: "text-red-500" },
    { k: "pausa", t: "Producción pausada", d: "No se agendan rodajes ni se manda a edición nada nuevo.", icono: PauseCircle, color: "text-red-600" },
  ];
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Escalones de mora activos</span>
        <Switch checked={m.activo} onCheckedChange={(v) => setM({ ...m, activo: v })} />
      </label>
      <div className={cn("grid gap-2 sm:grid-cols-3", !m.activo && "pointer-events-none opacity-50")}>
        {pasos.map((p) => (
          <div key={p.k} className="space-y-1.5 rounded-xl bg-muted/40 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <p.icono className={cn("h-4 w-4", p.color)} /> {p.t}
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">a los</span>
              <Input
                inputMode="numeric"
                className="h-8 w-16 text-center"
                value={String(m[p.k])}
                onChange={(e) => setM({ ...m, [p.k]: Number(e.target.value.replace(/\D/g, "").slice(0, 3)) || 0 })}
              />
              <span className="text-muted-foreground">días</span>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">{p.d}</p>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          onClick={async () => {
            setGuardando(true);
            try {
              await onGuardar(leerConfigMora({ mora: m }));
            } finally {
              setGuardando(false);
            }
          }}
          disabled={guardando}
        >
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </div>
    </div>
  );
}

/** Panel del cliente: si tiene pagos atrasados, qué debe y qué se le frena. */
export function AvisoMoraCliente({ cliente, onPagar }: { cliente: Project | undefined; onPagar?: () => void }) {
  const e = cliente?.mora;
  if (!e || !subeDe(e.nivel, "mora")) return null;
  const total = e.deuda + e.interes;
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-3 rounded-2xl border p-4", e.nivel === "pausa" ? "border-red-500/60 bg-red-500/10" : "border-orange-500/50 bg-orange-500/10")}>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white", e.nivel === "pausa" ? "bg-red-600" : "bg-orange-500")}>
        {e.nivel === "pausa" ? <PauseCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          Tenés un pago atrasado hace {e.dias} días · {formatARS(total)}
        </p>
        <p className="text-sm text-muted-foreground">
          {e.nivel === "pausa"
            ? "Pausamos la producción de tus videos hasta que te pongas al día. Apenas se registre el pago, seguimos."
            : e.nivel === "sin_extras"
              ? "Hasta ponerte al día no se pueden pedir videos ni piezas extra."
              : "Incluye el interés por mora (0,5% por día). Si ya pagaste, avisanos y lo marcamos."}
        </p>
      </div>
      {onPagar && (
        <Button onClick={onPagar} className={e.nivel === "pausa" ? "bg-red-600 hover:bg-red-600/90" : ""}>
          Ver y pagar
        </Button>
      )}
    </div>
  );
}

/** Para el equipo (video, rodaje): el cliente tiene la producción pausada por mora. */
export function AvisoPausaEquipo({ cliente, className }: { cliente: Project | undefined; className?: string }) {
  if (cliente?.mora?.nivel !== "pausa") return null;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2.5 text-sm", className)}>
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      <p>
        <b>Producción pausada por mora</b> ({cliente.mora.dias} días de atraso). No se pueden agendar rodajes ni mandar a edición hasta que pague. Lo destraba
        administración.
      </p>
    </div>
  );
}
