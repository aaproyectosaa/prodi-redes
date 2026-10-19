import { ExternalLink } from "lucide-react";
import { hrefSeguro } from "@/lib/utils";
import { StatCard, EmptyState } from "./PageShell";
import { useOpenVideo } from "./VideoCard";
import { formatARS, formatNum, fechaCorta } from "@/lib/redes/format";
import type { Video } from "@/lib/redes/types";
import { BarChart3 } from "lucide-react";

export interface ResumenMes {
  publicados: Video[];
  alcance: number;
  reproducciones: number;
  mensajes: number;
  interacciones: number;
  clics: number;
  gasto: number;
  costoMensaje: number | null;
  /** Cuántos de los publicados ya tienen resultados (si ninguno, se muestra "—" en vez de 0). */
  conResultados: number;
}

export function resumirMes(videos: Video[], proyectoId: string, mes: string): ResumenMes {
  const publicados = videos.filter(
    (v) => v.proyecto_id === proyectoId && v.mes === mes && v.etapa === "publicado"
  );
  const sum = (k: "alcance" | "reproducciones" | "mensajes" | "interacciones" | "clics" | "gasto") =>
    publicados.reduce((acc, v) => acc + (v.resultados?.[k] ?? 0), 0);
  const mensajes = sum("mensajes");
  const gasto = sum("gasto");
  return {
    publicados,
    alcance: sum("alcance"),
    reproducciones: sum("reproducciones"),
    mensajes,
    interacciones: sum("interacciones"),
    clics: sum("clics"),
    gasto,
    costoMensaje: mensajes > 0 && gasto > 0 ? gasto / mensajes : null,
    conResultados: publicados.filter((v) => v.resultados).length,
  };
}

/** Publicado hace menos de 2 días: la pauta todavía no tiene números. */
const tieneAnuncio = (v: Video) => !!(v.meta?.ad_id || v.meta?.campaign_id);

function esReciente(v: Video): boolean {
  const p = v.publicacion?.publicado_at;
  return !!p && Date.now() - new Date(p).getTime() < 2 * 86_400_000;
}

export function ResultadosMes({ resumen, grafico }: { resumen: ResumenMes; grafico?: React.ReactNode }) {
  const open = useOpenVideo();
  if (resumen.publicados.length === 0) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={BarChart3}
          title="Todavía no hay videos publicados este mes"
          description="Cuando publiquemos y pautemos tus videos, vas a ver acá los resultados."
        />
        {grafico}
      </div>
    );
  }
  // Sin resultados todavía: "—" (un 0 parece que algo anda mal).
  const hay = resumen.conResultados > 0;
  const sinPauta = !hay && !resumen.publicados.some(tieneAnuncio);
  const vacio = sinPauta ? "Sin pauta todavía" : "Cargando…";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Videos publicados" value={resumen.publicados.length} tone="primary" />
        <StatCard label="Personas alcanzadas" value={hay ? formatNum(resumen.alcance) : "—"} hint={hay ? undefined : vacio} />
        <StatCard label="Reproducciones" value={hay ? formatNum(resumen.reproducciones) : "—"} hint={hay ? undefined : vacio} />
        <StatCard label="Mensajes recibidos" value={hay ? formatNum(resumen.mensajes) : "—"} tone="success" hint={hay ? undefined : vacio} />
        <StatCard
          label="Inversión en pauta de los videos"
          value={hay ? formatARS(resumen.gasto) : "—"}
          hint={hay ? (resumen.costoMensaje ? `${formatARS(resumen.costoMensaje)} por mensaje` : undefined) : vacio}
        />
      </div>

      {grafico}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Video</th>
              <th className="px-4 py-2 text-right font-medium">Alcance</th>
              <th className="px-4 py-2 text-right font-medium">Reprod.</th>
              <th className="px-4 py-2 text-right font-medium">Mensajes</th>
              <th className="px-4 py-2 text-right font-medium">Inversión</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {resumen.publicados.map((v) => (
              <tr key={v.id} className="cursor-pointer hover:bg-muted/40" onClick={() => open(v.id)}>
                <td className="px-4 py-2.5">
                  <p className="max-w-[280px] truncate font-medium">{v.titulo}</p>
                  <p className="text-xs text-muted-foreground">
                    Publicado {fechaCorta(v.publicacion?.publicado_at)}
                    {v.pauta?.objetivo ? ` · ${v.pauta.objetivo}` : ""}
                  </p>
                </td>
                {v.resultados ? (
                  <>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatNum(v.resultados.alcance)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatNum(v.resultados.reproducciones)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatNum(v.resultados.mensajes)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatARS(v.resultados.gasto)}</td>
                  </>
                ) : (
                  <td colSpan={4} className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                    {!tieneAnuncio(v)
                      ? "Sin pauta todavía"
                      : esReciente(v)
                        ? "Los resultados aparecen a las 48 h de publicado"
                        : "Estamos cargando los resultados"}
                  </td>
                )}
                <td className="px-4 py-2.5 text-right">
                  {v.publicacion?.link_instagram && (
                    <a
                      href={hrefSeguro(v.publicacion.link_instagram)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Ver <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
