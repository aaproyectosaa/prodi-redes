import { useEffect, useMemo, useState } from "react";
import { Facebook, Instagram, TrendingDown, TrendingUp, Users } from "lucide-react";
import { collection, onSnapshot, query, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { cn } from "@/lib/utils";

// Crecimiento en redes de un cliente: los seguidores que el sistema anota solos todos los días (api/_lib/meta-redes.ts).
// Lo más fuerte para mostrar resultados: "tenías X, hoy tenés Y".

export interface FotoRedes {
  id: string;
  proyecto_id: string;
  fecha: string;
  ig_usuario?: string | null;
  ig_seguidores?: number | null;
  fb_seguidores?: number | null;
  ig_alcance_dia?: number | null;
  ig_visitas_perfil_dia?: number | null;
}

export function useMetricasRedes(proyectoId: string | undefined) {
  const [lista, setLista] = useState<FotoRedes[]>([]);
  useEffect(() => {
    if (!proyectoId) return;
    return onSnapshot(
      query(collection(db, "metricas_redes"), where("proyecto_id", "==", proyectoId)),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FotoRedes, "id">) })).sort((a, b) => a.fecha.localeCompare(b.fecha))),
      () => setLista([])
    );
  }, [proyectoId]);
  return lista;
}

const fmt = (n: number) => new Intl.NumberFormat("es-AR").format(Math.round(n));
const ddmm = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;

/** Curva de una serie (SVG simple, se adapta al ancho). */
function Curva({ valores, color }: { valores: number[]; color: string }) {
  if (valores.length < 2) return null;
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;
  const pts = valores.map((v, i) => `${(i / (valores.length - 1)) * 100},${36 - ((v - min) / rango) * 32}`);
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-16 w-full" aria-hidden>
      <polygon points={`0,40 ${pts.join(" ")} 100,40`} className={color} opacity={0.15} fill="currentColor" />
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.6} vectorEffect="non-scaling-stroke" className={color} />
    </svg>
  );
}

function Red({
  icono: Icono,
  nombre,
  usuario,
  serie,
  color,
  degradado,
}: {
  icono: React.ElementType;
  nombre: string;
  usuario?: string | null;
  serie: { fecha: string; v: number }[];
  color: string;
  degradado: string;
}) {
  if (!serie.length) return null;
  const ini = serie[0];
  const hoy = serie[serie.length - 1];
  const dif = hoy.v - ini.v;
  const pct = ini.v ? Math.round((dif / ini.v) * 100) : null;
  // Últimos 30 días (o lo que haya).
  const hace30 = serie.find((x) => x.fecha >= new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)) ?? ini;
  const mes = hoy.v - hace30.v;
  const sube = dif >= 0;
  return (
    <div className="space-y-2 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white", degradado)}>
          <Icono className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{nombre}</p>
          {usuario && <p className="truncate text-[11px] text-muted-foreground">@{usuario}</p>}
        </div>
      </div>
      <p className="text-3xl font-bold tabular-nums tracking-tight">{fmt(hoy.v)}</p>
      <p className="text-xs text-muted-foreground">seguidores hoy</p>
      {serie.length > 1 && (
        <>
          <p className={cn("flex flex-wrap items-center gap-1 text-sm font-semibold", sube ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
            {sube ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {sube ? "+" : ""}
            {fmt(dif)}
            {pct !== null && ` (${sube ? "+" : ""}${pct}%)`}
            <span className="font-normal text-muted-foreground">desde el {ddmm(ini.fecha)} ({fmt(ini.v)})</span>
          </p>
          <Curva valores={serie.map((x) => x.v)} color={color} />
          {hace30 !== ini && (
            <p className="text-[11px] text-muted-foreground">
              Últimos 30 días: {mes >= 0 ? "+" : ""}
              {fmt(mes)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Crecimiento de seguidores en Instagram y Facebook. Sin datos todavía: no muestra nada (o un aviso al equipo). */
export function CrecimientoRedes({ proyectoId, equipo = false }: { proyectoId: string; equipo?: boolean }) {
  const lista = useMetricasRedes(proyectoId);
  const ig = useMemo(() => lista.filter((x) => x.ig_seguidores != null).map((x) => ({ fecha: x.fecha, v: x.ig_seguidores as number })), [lista]);
  const fb = useMemo(() => lista.filter((x) => x.fb_seguidores != null).map((x) => ({ fecha: x.fecha, v: x.fb_seguidores as number })), [lista]);
  const usuario = [...lista].reverse().find((x) => x.ig_usuario)?.ig_usuario ?? null;
  const ultimo = lista[lista.length - 1];
  if (!ig.length && !fb.length) {
    return equipo ? (
      <div className="flex items-start gap-3 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        <Users className="mt-0.5 h-4 w-4 shrink-0" />
        Todavía no se están leyendo sus seguidores. Revisá la conexión en Ajustes → Instagram y Facebook de los clientes.
      </div>
    ) : null;
  }
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <h3 className="text-base font-semibold">Crecimiento en redes</h3>
        {ultimo && <p className="text-[11px] text-muted-foreground">Se actualiza solo todos los días · último: {ddmm(ultimo.fecha)}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Red icono={Instagram} nombre="Instagram" usuario={usuario} serie={ig} color="text-pink-500" degradado="from-[#F58529] via-[#DD2A7B] to-[#8134AF]" />
        <Red icono={Facebook} nombre="Facebook" serie={fb} color="text-blue-500" degradado="from-sky-500 to-blue-700" />
      </div>
      {ultimo?.ig_alcance_dia != null && (
        <p className="text-xs text-muted-foreground">
          Ayer en Instagram: {fmt(ultimo.ig_alcance_dia)} personas alcanzadas
          {ultimo.ig_visitas_perfil_dia != null ? ` · ${fmt(ultimo.ig_visitas_perfil_dia)} visitas al perfil` : ""}.
        </p>
      )}
    </section>
  );
}
