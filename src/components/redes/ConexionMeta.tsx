import { useState } from "react";
import { AlertTriangle, CheckCircle2, Link2Off, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";

type Estado = "ok" | "sin_ig" | "sin_acceso" | "error";
interface Fila {
  id: string;
  nombre: string;
  estado: Estado;
  detalle: string;
  pagina: string | null;
  ig: string | null;
  seguidores_ig: number | null;
  seguidores_fb: number | null;
  cuenta?: string | null;
}

const ESTADO: Record<Estado, { label: string; clase: string; icono: React.ElementType }> = {
  ok: { label: "Se lee", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icono: CheckCircle2 },
  sin_ig: { label: "Falta vincular Instagram", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icono: AlertTriangle },
  sin_acceso: { label: "Sin acceso", clase: "bg-muted text-muted-foreground", icono: Link2Off },
  error: { label: "Error", clase: "bg-red-500/15 text-red-700 dark:text-red-300", icono: XCircle },
};
const fmt = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("es-AR").format(n));

/**
 * Ajustes → Instagram y Facebook de los clientes: revisa cliente por cliente si el sistema puede leer sus redes
 * (con el usuario del sistema del Business Manager de Prodi). Lo que encuentra lo completa solo en la ficha.
 */
export function ConexionMeta() {
  const [cargando, setCargando] = useState(false);
  const [datos, setDatos] = useState<{ clientes: Fila[]; paginas: number } | null>(null);
  const revisar = async () => {
    setCargando(true);
    try {
      const r = await callApi<{ clientes: Fila[]; paginas: number }>("/api/informes/meta-redes");
      setDatos(r);
      const ok = r.clientes.filter((c) => c.estado === "ok").length;
      toast.success(`${ok} de ${r.clientes.length} clientes se pueden leer`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo revisar");
    } finally {
      setCargando(false);
    }
  };
  const ok = datos?.clientes.filter((c) => c.estado === "ok").length ?? 0;
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {datos ? (
            <>
              <b className="text-foreground">{ok}</b> de {datos.clientes.length} clientes se leen solos · Prodi ve {datos.paginas} página{datos.paginas === 1 ? "" : "s"} en Meta.
            </>
          ) : (
            "Tocá revisar para ver qué clientes ya se pueden leer y a cuáles les falta algo."
          )}
        </p>
        <Button onClick={revisar} disabled={cargando}>
          {cargando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {datos ? "Revisar de nuevo" : "Revisar conexión"}
        </Button>
      </div>
      {datos && (
        <div className="divide-y rounded-xl border">
          {datos.clientes.map((c) => {
            const e = ESTADO[c.estado];
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 font-medium">{c.nombre}</span>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", e.clase)}>
                  <e.icono className="h-3 w-3" /> {e.label}
                </span>
                <span className="w-full text-xs text-muted-foreground">
                  {c.estado === "ok" ? `@${c.ig} · ${fmt(c.seguidores_ig)} seguidores en Instagram · ${fmt(c.seguidores_fb)} en Facebook` : c.detalle}
                  {c.cuenta ? ` · Cuenta publicitaria: ${c.cuenta}` : " · Sin cuenta publicitaria"}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium">¿Qué hago si a un cliente le falta algo?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>
            <b>Sin acceso</b>: en Meta Business de Prodi → Configuración → Usuarios del sistema → asignale la página de ese cliente al usuario del sistema (el
            mismo de la pauta). Si se llama distinto, cargá su usuario de Instagram en la ficha del cliente.
          </li>
          <li>
            <b>Falta vincular Instagram</b>: el Instagram del cliente tiene que ser profesional (empresa o creador) y estar vinculado a su página de Facebook.
          </li>
          <li>
            <b>Error</b> de permisos: el token tiene que tener además <code>instagram_basic</code>, <code>instagram_manage_insights</code> y{" "}
            <code>pages_read_engagement</code>. Se genera de nuevo y se reemplaza META_ACCESS_TOKEN en Vercel.
          </li>
        </ul>
      </details>
    </div>
  );
}
