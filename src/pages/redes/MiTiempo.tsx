import { useEffect, useMemo, useState } from "react";
import { Check, Code2, Copy, Loader2, MonitorSmartphone, Plug, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";

interface DiaTiempo {
  fecha: string;
  total: number;
  app: number;
  claude: number;
  desde: string | null;
  hasta: string | null;
  en: { fuente: "app" | "claude"; que: string; minutos: number }[];
}

const horas = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
};
const hoyAR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const nombreDia = (f: string) =>
  new Date(`${f}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });

/** Cuánto trabajó el admin por día y en qué: la app y Claude Code. Solo lo ve él. */
export default function MiTiempo() {
  const [datos, setDatos] = useState<{ dias: DiaTiempo[]; conectado: boolean } | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      callApi<{ dias: DiaTiempo[]; conectado: boolean }>("/api/usuarios/tiempo-ver", { dias: 14 })
        .then((d) => vivo && setDatos(d))
        .catch((e) => vivo && toast.error(e instanceof Error ? e.message : "No se pudo cargar"));
    void cargar();
    const t = window.setInterval(cargar, 120_000);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, []);

  // Los últimos 14 días, también los que no hubo nada (para el gráfico).
  const dias = useMemo(() => {
    const por = new Map((datos?.dias ?? []).map((d) => [d.fecha, d]));
    const hoy = hoyAR();
    return Array.from({ length: 14 }, (_, i) => {
      const f = new Date(Date.parse(`${hoy}T12:00:00Z`) - (13 - i) * 86_400_000).toISOString().slice(0, 10);
      return por.get(f) ?? { fecha: f, total: 0, app: 0, claude: 0, desde: null, hasta: null, en: [] };
    });
  }, [datos]);
  const hoy = dias[dias.length - 1];
  const dia = dias.find((d) => d.fecha === elegido) ?? hoy;
  const conDatos = dias.filter((d) => d.total > 0);
  const semana = dias.slice(-7);
  const promedio = conDatos.length ? Math.round(conDatos.reduce((a, d) => a + d.total, 0) / conDatos.length) : 0;
  const totalSemana = semana.reduce((a, d) => a + d.total, 0);
  const claudeSemana = semana.reduce((a, d) => a + d.claude, 0);
  const max = Math.max(60, ...dias.map((d) => d.app + d.claude));

  const conectar = async () => {
    setCreando(true);
    try {
      const r = await callApi<{ token: string }>("/api/usuarios/tiempo-token", {});
      setToken(r.token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    } finally {
      setCreando(false);
    }
  };
  const comando = token
    ? `Set-Content -Path "$HOME\\.prodi-tiempo.json" -Value '{"url":"${window.location.origin}","token":"${token}"}'`
    : "";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Timer className="h-6 w-6 text-primary" /> Mi tiempo
        </h1>
        <p className="text-sm text-muted-foreground">Cuánto trabajaste por día y en qué: en la app y programando con Claude Code. Solo lo ves vos.</p>
      </div>

      {!datos ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Hoy" valor={horas(hoy.total)} sub={hoy.desde ? `de ${hoy.desde} a ${hoy.hasta}` : "Todavía nada"} color="from-violet-500 to-fuchsia-500" />
            <Kpi label="Esta semana" valor={horas(totalSemana)} sub="últimos 7 días" color="from-sky-400 to-blue-500" />
            <Kpi label="Promedio por día" valor={horas(promedio)} sub={`${conDatos.length} días con actividad`} color="from-amber-400 to-orange-500" />
            <Kpi
              label="Con Claude Code"
              valor={totalSemana ? `${Math.round((claudeSemana / totalSemana) * 100)}%` : "—"}
              sub={`${horas(claudeSemana)} esta semana`}
              color="from-emerald-400 to-teal-500"
            />
          </div>

          {/* Por día: app + Claude Code */}
          <div className="rounded-3xl border bg-card p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Últimos 14 días</p>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> App
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Claude Code
                </span>
              </div>
            </div>
            <div className="flex h-44 items-end gap-1.5 sm:gap-2">
              {dias.map((d) => (
                <button
                  key={d.fecha}
                  type="button"
                  onClick={() => setElegido(d.fecha)}
                  title={`${nombreDia(d.fecha)}: ${horas(d.total)}`}
                  className={cn("group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-lg pt-1", dia.fecha === d.fecha && "bg-muted/60")}
                >
                  <span className="text-[10px] tabular-nums text-muted-foreground">{d.total ? `${Math.round((d.total / 60) * 10) / 10}h` : ""}</span>
                  <span className="flex w-full max-w-8 flex-col overflow-hidden rounded-md">
                    <span className="bg-emerald-500 transition-all" style={{ height: `${(d.claude / max) * 130}px` }} />
                    <span className="bg-primary transition-all" style={{ height: `${(d.app / max) * 130}px` }} />
                  </span>
                  <span className={cn("text-[10px] text-muted-foreground", dia.fecha === d.fecha && "font-bold text-foreground")}>
                    {new Date(`${d.fecha}T12:00:00`).getDate()}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* En qué, el día elegido */}
          <div className="rounded-3xl border bg-card p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold capitalize">{dia.fecha === hoy.fecha ? "Hoy" : nombreDia(dia.fecha)}</p>
              <p className="text-sm text-muted-foreground">
                {dia.total ? `${horas(dia.total)} · de ${dia.desde} a ${dia.hasta}` : "Sin actividad"}
              </p>
            </div>
            {dia.en.length ? (
              <ul className="space-y-2">
                {dia.en.map((x) => (
                  <li key={`${x.fuente}${x.que}`} className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      {x.fuente === "claude" ? <Code2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <MonitorSmartphone className="h-4 w-4 shrink-0 text-primary" />}
                      <span className="min-w-0 flex-1 truncate">{x.que}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{horas(x.minutos)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", x.fuente === "claude" ? "bg-emerald-500" : "bg-primary")}
                        style={{ width: `${(x.minutos / dia.en[0].minutos) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Tocá un día del gráfico para ver en qué estuviste.</p>
            )}
          </div>

          {/* Claude Code */}
          <div className="rounded-3xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                <Plug className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Claude Code</p>
                <p className="text-xs text-muted-foreground">
                  {datos.conectado
                    ? "Conectado: cada minuto que programás con Claude Code se suma acá, con el proyecto y en qué estabas."
                    : "Conectalo para que también cuente el tiempo que programás con Claude Code."}
                </p>
              </div>
              <Button variant={datos.conectado ? "outline" : "default"} className="rounded-full" disabled={creando} onClick={() => void conectar()}>
                {creando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : datos.conectado ? <Check className="mr-2 h-4 w-4" /> : <Plug className="mr-2 h-4 w-4" />}
                {datos.conectado ? "Generar otro token" : "Conectar"}
              </Button>
            </div>
            {token && (
              <div className="mt-4 space-y-2 rounded-2xl bg-muted/40 p-3 text-sm">
                <p>
                  <b>1.</b> Copiá esto y pegalo en PowerShell (guarda tu token en tu compu; no lo mandes por chat):
                </p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-background p-2 text-[11px]">{comando}</code>
                  <Button
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => void navigator.clipboard.writeText(comando).then(() => toast.success("Copiado"))}
                    aria-label="Copiar"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p>
                  <b>2.</b> Listo: Claude Code ya tiene el aviso configurado y empieza a sumar desde el próximo mensaje. El token se ve una sola vez; si
                  generás otro, el anterior deja de andar.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, valor, sub, color }: { label: string; valor: string; sub: string; color: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <span className={cn("mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white", color)}>
        <Timer className="h-4 w-4" />
      </span>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums tracking-tight">{valor}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
