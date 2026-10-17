import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarX, Check, Clock, Copy, ImageIcon, Link2Off, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { FilaKpis, Kpi, Pestanias, Vacio, type Pestania } from "@/components/redes/admin/AdminUI";
import { useRedes } from "@/contexts/redes-data-context";
import type { Profile } from "@/integrations/firebase/types";
import { auditoriaPauta, DIAS_PARA_PUBLICAR, DIAS_RESULTADOS } from "@/lib/redes/auditoriaPauta";
import { hace, mesLabel } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

type Vista = "esperando" | "tarde" | "meta" | "resultados" | "piezas" | "clientes";

const fh = (h: number | null) => (h === null ? "—" : h < 24 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1).replace(".", ",")} días`);
const ddmm = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;

/** Reporte a fondo de quien sube y pauta (en Reportes → su ficha). */
export function ReportePauta({ perfil, mes }: { perfil: Profile; mes: string }) {
  const { videos, piezas, clientes } = useRedes();
  const navigate = useNavigate();
  const openVideo = useOpenVideo();
  const nombre = perfil.nombre?.split(" ")[0] ?? "Esta persona";
  const a = useMemo(() => auditoriaPauta(perfil.id, videos, piezas, clientes, mes, nombre), [perfil.id, videos, piezas, clientes, mes, nombre]);
  const actual = a.meses[a.meses.length - 1];
  const viejos = a.esperando.filter((x) => x.dias > DIAS_PARA_PUBLICAR).length;
  const desatendidos = a.clientes.filter((c) => c.desatendido).length;

  const sugerida: Vista = viejos ? "esperando" : a.sinMeta.length ? "meta" : a.tarde.length ? "tarde" : a.resultadosViejos.length ? "resultados" : "clientes";
  const [vista, setVista] = useState<Vista | null>(null);
  const v = vista ?? sugerida;
  const pestanias: Pestania<Vista>[] = [
    { k: "esperando", label: "Esperando publicar", n: a.esperando.length, alerta: viejos > 0 },
    { k: "tarde", label: "Publicados tarde", n: a.tarde.length, alerta: a.tarde.length > 0 },
    { k: "meta", label: "Sin ID de Meta", n: a.sinMeta.length, alerta: a.sinMeta.length > 0 },
    { k: "resultados", label: "Resultados viejos", n: a.resultadosViejos.length, alerta: a.resultadosViejos.length > 0 },
    { k: "piezas", label: "Piezas sin publicar", n: a.piezasSinPublicar.length, alerta: a.piezasSinPublicar.length > 0 },
    { k: "clientes", label: "Por cliente", n: desatendidos, alerta: desatendidos > 0 },
  ];

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(`Reporte de ${perfil.nombre} · ${mesLabel(mes)}\n\n${a.resumen.map((r) => `• ${r}`).join("\n")}`);
      toast.success("Resumen copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const maxPub = Math.max(1, ...a.meses.map((m) => m.publicados));
  const cambio = a.promedioAntes ? Math.round(((actual.publicados - a.promedioAntes) / a.promedioAntes) * 100) : null;

  return (
    <section className="space-y-5">
      {/* Resumen en palabras, para la charla */}
      <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] to-fuchsia-500/[0.05] p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-bold">Resumen de {mesLabel(mes).toLowerCase()}</p>
          <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={copiar}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
          </Button>
        </div>
        <ul className="space-y-1 text-sm">
          {a.resumen.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {r}
            </li>
          ))}
        </ul>
      </div>

      <FilaKpis>
        <Kpi
          icono={Clock}
          label="Esperando publicar"
          valor={String(a.esperando.length)}
          sub={a.esperando.length ? `el más viejo: ${a.esperando[0].dias} días` : "Nada pendiente"}
          tono={viejos ? "rojo" : "verde"}
          onClick={() => setVista("esperando")}
        />
        <Kpi
          icono={RefreshCw}
          label="Tarda en publicar"
          valor={fh(actual.tarda)}
          sub="desde que aprueba el cliente"
          tono={actual.tarda !== null && actual.tarda > 24 * DIAS_PARA_PUBLICAR ? "rojo" : "violeta"}
        />
        <Kpi
          icono={CalendarX}
          label="Publicados tarde"
          valor={String(a.tarde.length)}
          sub="después de la fecha del cliente"
          tono={a.tarde.length ? "rojo" : "verde"}
          onClick={() => setVista("tarde")}
        />
        <Kpi
          icono={Link2Off}
          label="Pautados sin ID de Meta"
          valor={String(a.sinMeta.length)}
          sub="no traen resultados"
          tono={a.sinMeta.length ? "rojo" : "verde"}
          onClick={() => setVista("meta")}
        />
      </FilaKpis>

      {/* Mes a mes: publicados (barras) y cuánto tardó */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">Mes a mes</p>
          {cambio !== null && (
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", cambio < -20 ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground")}>
              {cambio > 0 ? "+" : ""}
              {cambio}% vs los 3 meses anteriores
            </span>
          )}
        </div>
        <div className="flex h-36 gap-2">
          {a.meses.map((m, i) => {
            const ultimo = i === a.meses.length - 1;
            return (
              <div key={m.mes} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
                <span className="text-xs font-bold tabular-nums">{m.publicados}</span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={cn("w-full rounded-t-lg", ultimo ? "bg-gradient-to-t from-[#6F40FC] to-[#E040A0]" : "bg-primary/30")}
                    style={{ height: `${Math.max(4, (m.publicados / maxPub) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] uppercase text-muted-foreground">{mesLabel(m.mes).slice(0, 3)}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-6 gap-2 border-t pt-2 text-center text-[10px] text-muted-foreground">
          {a.meses.map((m) => (
            <div key={m.mes} className="space-y-0.5">
              <p title="Tardó en publicar">{fh(m.tarda)}</p>
              <p className={m.tarde ? "font-semibold text-red-600 dark:text-red-400" : ""}>{m.tarde} tarde</p>
              <p className={m.sinMeta ? "font-semibold text-red-600 dark:text-red-400" : ""}>{m.sinMeta} sin ID</p>
            </div>
          ))}
        </div>
      </div>

      <Pestanias<Vista> items={pestanias} valor={v} onChange={(k) => setVista(k)} />

      <div className="space-y-2">
        {v === "esperando" &&
          (a.esperando.length ? (
            a.esperando.map(({ video, dias }) => (
              <Fila key={video.id} onClick={() => openVideo(video.id)} rojo={dias > DIAS_PARA_PUBLICAR}>
                <ClienteTag cliente={clientes.find((c) => c.id === video.proyecto_id)} />
                <span className="min-w-0 flex-1 truncate font-medium">{video.titulo}</span>
                <Pill rojo={dias > DIAS_PARA_PUBLICAR}>{dias === 0 ? "aprobado hoy" : `hace ${dias} días`}</Pill>
              </Fila>
            ))
          ) : (
            <Vacio icono={Check} titulo="No hay nada esperando" texto="Todo lo aprobado ya está publicado." />
          ))}
        {v === "tarde" &&
          (a.tarde.length ? (
            a.tarde.map(({ video, dias, publicado }) => (
              <Fila key={video.id} onClick={() => openVideo(video.id)} rojo>
                <ClienteTag cliente={clientes.find((c) => c.id === video.proyecto_id)} />
                <span className="min-w-0 flex-1 truncate font-medium">{video.titulo}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  pedido para el {ddmm(video.fecha_deseada!)} · salió el {ddmm(publicado.slice(0, 10))}
                </span>
                <Pill rojo>{dias} días tarde</Pill>
              </Fila>
            ))
          ) : (
            <Vacio icono={Check} titulo="Nada publicado tarde este mes" />
          ))}
        {v === "meta" &&
          (a.sinMeta.length ? (
            a.sinMeta.map((video) => (
              <Fila key={video.id} onClick={() => openVideo(video.id)} rojo>
                <ClienteTag cliente={clientes.find((c) => c.id === video.proyecto_id)} />
                <span className="min-w-0 flex-1 truncate font-medium">{video.titulo}</span>
                <Pill rojo>sin ID del anuncio</Pill>
              </Fila>
            ))
          ) : (
            <Vacio icono={Check} titulo="Todo lo pautado tiene su ID de Meta" />
          ))}
        {v === "resultados" &&
          (a.resultadosViejos.length ? (
            a.resultadosViejos.map(({ video, dias }) => (
              <Fila key={video.id} onClick={() => openVideo(video.id)} rojo>
                <ClienteTag cliente={clientes.find((c) => c.id === video.proyecto_id)} />
                <span className="min-w-0 flex-1 truncate font-medium">{video.titulo}</span>
                <Pill rojo>{dias === null ? "nunca se cargaron" : `hace ${dias} días`}</Pill>
              </Fila>
            ))
          ) : (
            <Vacio icono={Check} titulo={`Todas las pautas activas tienen resultados de los últimos ${DIAS_RESULTADOS} días`} />
          ))}
        {v === "piezas" &&
          (a.piezasSinPublicar.length ? (
            a.piezasSinPublicar.map(({ pieza, dias }) => (
              <Fila key={pieza.id} onClick={() => navigate(`/piezas?pieza=${pieza.id}`)} rojo={dias > DIAS_PARA_PUBLICAR}>
                <ImageIcon className="h-4 w-4 shrink-0 text-pink-500" />
                <ClienteTag cliente={clientes.find((c) => c.id === pieza.proyecto_id)} />
                <span className="min-w-0 flex-1 truncate font-medium">{pieza.producto || pieza.pedido}</span>
                <Pill rojo={dias > DIAS_PARA_PUBLICAR}>aprobada hace {dias} días</Pill>
              </Fila>
            ))
          ) : (
            <Vacio icono={Check} titulo="No hay piezas aprobadas sin publicar" />
          ))}
        {v === "clientes" &&
          (a.clientes.length ? (
            <div className="overflow-x-auto rounded-2xl border bg-card">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-2 py-2 text-center font-medium">Esperando</th>
                    <th className="px-2 py-2 text-center font-medium">Publicados</th>
                    <th className="px-2 py-2 text-center font-medium">Pauta activa</th>
                    <th className="px-2 py-2 text-center font-medium">Piezas</th>
                    <th className="px-3 py-2 font-medium">Últimos resultados</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {a.clientes.map((f) => (
                    <tr key={f.cliente.id} className={f.desatendido ? "bg-red-500/[0.05]" : ""}>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          {f.desatendido && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                          <ClienteTag cliente={f.cliente} />
                        </span>
                      </td>
                      <td className={cn("px-2 py-2 text-center tabular-nums", f.masViejo > DIAS_PARA_PUBLICAR && "font-bold text-red-600 dark:text-red-400")}>
                        {f.esperando}
                        {f.esperando ? <span className="block text-[10px] font-normal text-muted-foreground">{f.masViejo} días</span> : null}
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums">{f.publicadosMes}</td>
                      <td className="px-2 py-2 text-center tabular-nums">{f.pautaActiva}</td>
                      <td className={cn("px-2 py-2 text-center tabular-nums", f.piezasSinPublicar && "font-bold text-red-600 dark:text-red-400")}>{f.piezasSinPublicar}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{f.ultimoResultado ? hace(f.ultimoResultado) : "nunca"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Vacio icono={Users} titulo="No tiene clientes asignados" />
          ))}
      </div>
    </section>
  );
}

function Fila({ children, onClick, rojo }: { children: React.ReactNode; onClick: () => void; rojo?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/50",
        rojo && "border-red-500/40 bg-red-500/[0.04]"
      )}
    >
      {children}
    </button>
  );
}

function Pill({ children, rojo }: { children: React.ReactNode; rojo?: boolean }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", rojo ? "bg-red-500 text-white" : "bg-muted text-muted-foreground")}>{children}</span>
  );
}
