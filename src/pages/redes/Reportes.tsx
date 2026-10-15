import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Clock, Eye, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell, Section, EmptyState } from "@/components/redes/PageShell";
import { VideoCard, useOpenVideo } from "@/components/redes/VideoCard";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useVerComo } from "@/components/redes/VerComo";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { abrirDirecto } from "@/lib/redes/chat";
import { abrirEnDock } from "@/lib/redes/chatDock";
import { eventos, reporteUsuario, type ReporteUsuario } from "@/lib/redes/reportes";
import { fechaHora, hace, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { getRoleInfo } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { callApi } from "@/lib/redes/api";

type Uso = { uid: string; dias: number; entrada: number; salida: number; minutos: number; noches?: number; largos?: number };

/** Para cuidar al equipo: noches (después de las 21 o de madrugada) y días de más de 9 h en los últimos 14 días. */
function cargaDe(uso?: Uso, act?: Uso) {
  const noches = Math.max(uso?.noches ?? 0, act?.noches ?? 0);
  const largos = Math.max(uso?.largos ?? 0, act?.largos ?? 0);
  return { noches, largos, alerta: noches >= 3 || largos >= 3 };
}

function AlertaCarga({ uso, act, grande = false }: { uso?: Uso; act?: Uso; grande?: boolean }) {
  const { noches, largos, alerta } = cargaDe(uso, act);
  if (!noches && !largos) return null;
  const partes = [
    noches ? `${noches} ${noches === 1 ? "noche" : "noches"} después de las 21` : null,
    largos ? `${largos} ${largos === 1 ? "día" : "días"} de más de 9 h` : null,
  ].filter(Boolean);
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-2.5 py-2",
        grande ? "text-sm" : "text-[11px]",
        alerta ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-foreground"
      )}
    >
      <AlertTriangle className={cn("mt-0.5 shrink-0", grande ? "h-4 w-4" : "h-3.5 w-3.5")} />
      <span>
        <b>{partes.join(" · ")}</b> en las últimas 2 semanas.{alerta ? " Conviene hablarlo." : ""}
      </span>
    </div>
  );
}

type DatosUso = { usos: Uso[]; desde: string | null; actividad: Uso[]; hechos: Record<string, Record<string, number>> };

/** Promedios de uso de la app (últimos 30 días): hora de entrada, de salida y horas por día.
 *  Además, la jornada según el historial (primera y última acción de cada día), que ya tiene datos para atrás. */
function useUsoEquipo(mes: string) {
  const [datos, setDatos] = useState<DatosUso | null>(null);
  useEffect(() => {
    let vivo = true;
    callApi<DatosUso>("/api/db/uso", { solo_vista: true, mes })
      .then((d) => vivo && setDatos({ usos: d.usos ?? [], desde: d.desde ?? null, actividad: d.actividad ?? [], hechos: d.hechos ?? {} }))
      .catch(() => vivo && setDatos({ usos: [], desde: null, actividad: [], hechos: {} }));
    return () => {
      vivo = false;
    };
  }, [mes]);
  return datos;
}

/** Roles que aparecen en "Equipo". */
const ROLES_EQUIPO = ["productor", "editor", "pauta", "diseno", "administracion"];

/** "N videos en su cancha" o, en diseño, piezas. Administración no tiene cola. */
function Cancha({ r }: { r: ReporteUsuario }) {
  if (r.perfil.role === "administracion") return null;
  const diseno = r.perfil.role === "diseno";
  return (
    <p>
      <span className="text-lg font-bold text-foreground">{diseno ? r.piezasEnCancha.length : r.enSuCancha.length}</span>{" "}
      {diseno ? "piezas" : "videos"} en su cancha
    </p>
  );
}

const hora = (min: number) => {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
const horas = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1).replace(".", ",")} h`);

// Eje del día para las barras de horario (6 a 24 h).
const EJE_DESDE = 6 * 60;
const EJE_HASTA = 24 * 60;
const pos = (min: number) => `${(Math.min(Math.max(min, EJE_DESDE), EJE_HASTA) - EJE_DESDE) / (EJE_HASTA - EJE_DESDE) * 100}%`;

/** Una franja del día: de la hora de inicio a la de fin, sobre el eje de 6 a 24 h. */
function Franja({ u, tono, alto = "h-2.5" }: { u?: Uso; tono: "fuerte" | "suave"; alto?: string }) {
  return (
    <div className={cn("relative w-full overflow-hidden rounded-full bg-muted/60", alto)}>
      {/* Guías cada 3 h */}
      {[9, 12, 15, 18, 21].map((h) => (
        <span key={h} className="absolute inset-y-0 w-px bg-background/70" style={{ left: pos(h * 60) }} />
      ))}
      {u && (
        <span
          className={cn("absolute inset-y-0 rounded-full", tono === "fuerte" ? "bg-primary" : "bg-primary/40")}
          style={{ left: pos(u.entrada), width: `max(6px, calc(${pos(u.salida)} - ${pos(u.entrada)}))` }}
        />
      )}
    </div>
  );
}

function Eje() {
  return (
    <div className="relative h-3 text-[10px] tabular-nums text-muted-foreground">
      {[6, 9, 12, 15, 18, 21, 24].map((h, i, xs) => (
        <span
          key={h}
          className={cn("absolute", i === 0 ? "" : i === xs.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
          style={{ left: pos(h * 60) }}
        >
          {h}
        </span>
      ))}
    </div>
  );
}

function Dato({ label, valor, ayuda }: { label: string; valor: string; ayuda?: string }) {
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{valor}</p>
      {ayuda && <p className="text-[11px] text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

/** Horarios de una persona: jornada (por su actividad) y tiempo con la app abierta. */
function UsoLinea({ datos, uid, grande = false }: { datos: DatosUso | null; uid: string; grande?: boolean }) {
  const uso = datos?.usos.find((u) => u.uid === uid);
  const act = datos?.actividad.find((u) => u.uid === uid);
  const dias = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

  if (!grande) {
    // Tarjeta del equipo: una franja y el resumen.
    return (
      <div className="space-y-1.5 rounded-lg border bg-background/40 p-2.5">
        <div className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" /> Horario
          </span>
          {act ? (
            <span className="tabular-nums">
              <b>{hora(act.entrada)} – {hora(act.salida)}</b>
              <span className="text-muted-foreground"> · {horas(act.minutos)}/día</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{datos ? "sin datos" : "…"}</span>
          )}
        </div>
        <Franja u={act} tono="fuerte" alto="h-2" />
        <AlertaCarga uso={uso} act={act} />
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Clock className="h-4 w-4 text-muted-foreground" /> Horarios
        </p>
        <p className="text-[11px] text-muted-foreground">Promedio de los últimos 30 días</p>
      </div>
      {!datos ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
          <div className="grid grid-cols-3 gap-2">
            <Dato label="Empieza" valor={act ? hora(act.entrada) : "—"} />
            <Dato label="Termina" valor={act ? hora(act.salida) : "—"} />
            <Dato label="Por día" valor={act ? horas(act.minutos) : "—"} ayuda={act ? dias(act.dias) : undefined} />
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[76px_minmax(0,1fr)_64px] items-center gap-x-3 gap-y-2 text-xs">
              <span className="text-muted-foreground">Jornada</span>
              <Franja u={act} tono="fuerte" />
              <span className="text-right tabular-nums">{act ? horas(act.minutos) : "—"}</span>
              <span className="text-muted-foreground">App abierta</span>
              <Franja u={uso} tono="suave" />
              <span className="text-right tabular-nums text-muted-foreground">{uso ? horas(uso.minutos) : "desde hoy"}</span>
              <span />
              <Eje />
              <span />
            </div>
          </div>
          <div className="md:col-span-2">
            <AlertaCarga uso={uso} act={act} grande />
          </div>
        </div>
      )}
    </div>
  );
}

function MesSelect({ mes, setMes }: { mes: string; setMes: (m: string) => void }) {
  return (
    <Select value={mes} onValueChange={setMes}>
      <SelectTrigger className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[0, -1, -2, -3, -4, -5].map((d) => {
          const m = sumarMeses(mesActual(), d);
          return (
            <SelectItem key={m} value={m}>
              {mesLabel(m)}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function Barras({ semanas }: { semanas: ReporteUsuario["semanas"] }) {
  const max = Math.max(1, ...semanas.map((s) => s.n));
  return (
    <div className="flex h-16 items-end gap-1.5" aria-label="Actividad por semana">
      {semanas.map((s, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={cn("w-full rounded-t-sm", i === semanas.length - 1 ? "bg-primary" : "bg-primary/35")}
            style={{ height: `${Math.max(4, (s.n / max) * 48)}px` }}
            title={`${s.n} acciones`}
          />
          <span className="text-[9px] text-muted-foreground">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function KpiGrid({ r, grande = false }: { r: ReporteUsuario; grande?: boolean }) {
  return (
    <div className={cn("grid gap-2", grande ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2")}>
      {r.kpis.map((k) => (
        <div key={k.label} className={cn("rounded-lg border bg-background/40 p-2.5", grande && "p-4")}>
          <p className="text-[11px] text-muted-foreground">{k.label}</p>
          <p
            className={cn(
              "font-bold tabular-nums",
              grande ? "text-2xl" : "text-lg",
              k.tono === "alerta" && "text-warning",
              k.tono === "bien" && k.valor !== "—" && "text-foreground"
            )}
          >
            {k.valor}
          </p>
          {k.ayuda && <p className="text-[11px] text-muted-foreground">{k.ayuda}</p>}
        </div>
      ))}
    </div>
  );
}

export default function Reportes() {
  const navigate = useNavigate();
  const { videos, rodajes, reuniones, piezas, clientes: proyectos } = useRedes();
  const { profiles } = useAppData();
  const [mes, setMes] = useState(mesActual());
  const uso = useUsoEquipo(mes);
  const todos = useMemo(() => eventos(videos), [videos]);

  const equipo = profiles
    .filter((p) => ROLES_EQUIPO.includes(p.role ?? ""))
    .map((p) => reporteUsuario(p, videos, rodajes, reuniones, mes, todos, { piezas, clientes: proyectos, hechos: uso?.hechos[p.id] }));
  const clientes = profiles
    .filter((p) => p.role === "cliente")
    .map((p) => reporteUsuario(p, videos, rodajes, reuniones, mes, todos));

  return (
    <PageShell title="Reportes" subtitle="Qué hizo cada persona y cómo viene rindiendo." actions={<MesSelect mes={mes} setMes={setMes} />}>
      <Section
        title="Equipo"
        description="Horario promedio de los últimos 30 días, según su primera y última acción de cada día."
      >
        {equipo.length === 0 ? (
          <EmptyState title="No hay personas con rol de equipo" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {equipo.map((r) => (
              <button
                key={r.perfil.id}
                type="button"
                onClick={() => navigate(`/reportes/${r.perfil.id}`)}
                className="space-y-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <div className="flex items-center gap-3">
                  <UserAvatar profile={r.perfil} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.perfil.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {getRoleInfo(r.perfil.role).label} · {r.ultimaActividad ? `activo ${hace(r.ultimaActividad)}` : "sin actividad"}
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <UsoLinea datos={uso} uid={r.perfil.id} />
                <KpiGrid r={r} />
                <div className="flex items-end justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    <Cancha r={r} />
                    <p>{r.acciones} acciones en el mes</p>
                  </div>
                  <div className="w-36">
                    <Barras semanas={r.semanas} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Clientes" className="mt-10" description="Cuánto tardan en aprobar y cuántos cambios piden.">
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Usuario</th>
                {(clientes[0]?.kpis ?? []).map((k) => (
                  <th key={k.label} className="px-4 py-2 text-right font-medium">
                    {k.label}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">Último acceso</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clientes.map((r) => (
                <tr key={r.perfil.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/reportes/${r.perfil.id}`)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <UserAvatar profile={r.perfil} size="sm" />
                      <span className="font-medium">{r.perfil.nombre}</span>
                    </div>
                  </td>
                  {r.kpis.map((k) => (
                    <td key={k.label} className={cn("px-4 py-2.5 text-right tabular-nums", k.tono === "alerta" && "font-semibold text-warning")}>
                      {k.valor}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{r.perfil.ultimo_acceso ? hace(r.perfil.ultimo_acceso) : "nunca"}</td>
                </tr>
              ))}
              {clientes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Sin usuarios de clientes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </PageShell>
  );
}

export function ReporteDetalle() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const { videos, rodajes, reuniones, clienteById, piezas, clientes: proyectos } = useRedes();
  const { profiles } = useAppData();
  const { realUser } = useUserProfileContext();
  const { entrar } = useVerComo();
  const openVideo = useOpenVideo();
  const [mes, setMes] = useState(mesActual());
  const uso = useUsoEquipo(mes);
  const perfil = profiles.find((p) => p.id === uid);
  if (!perfil) {
    return (
      <PageShell title="Reporte">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </PageShell>
    );
  }
  const r = reporteUsuario(perfil, videos, rodajes, reuniones, mes, undefined, { piezas, clientes: proyectos, hechos: uso?.hechos[perfil.id] });
  const esPieza = (id: string) => !videos.some((v) => v.id === id) && piezas.some((p) => p.id === id);
  const susClientes = videos
    .filter((v) => [v.productor_id, v.editor_id, v.pauta_id].includes(perfil.id))
    .map((v) => v.proyecto_id);
  const clientesIds = Array.from(new Set(susClientes));

  return (
    <PageShell
      title={
        <span className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button type="button" onClick={() => navigate("/reportes")} className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground" aria-label="Volver">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <UserAvatar profile={perfil} size="md" />
          <span className="min-w-0 break-words">{perfil.nombre}</span>
        </span>
      }
      subtitle={`${getRoleInfo(perfil.role).label} · ${r.ultimaActividad ? `última actividad ${hace(r.ultimaActividad)}` : "sin actividad registrada"}`}
      actions={
        <>
          <MesSelect mes={mes} setMes={setMes} />
          <Button
            variant="outline"
            onClick={async () => {
              if (!realUser) return;
              const id = await abrirDirecto(realUser.uid, perfil.id, { [realUser.uid]: "", [perfil.id]: perfil.nombre ?? "" });
              if (!abrirEnDock(id)) navigate(`/chat?c=${id}`);
            }}
          >
            <MessageCircle className="mr-2 h-4 w-4" /> Mensaje
          </Button>
          <Button onClick={() => entrar(perfil.id)}>
            <Eye className="mr-2 h-4 w-4" /> Ver como {perfil.nombre?.split(" ")[0]}
          </Button>
        </>
      }
    >
      <KpiGrid r={r} grande />
      {realUser && perfil.role !== "cliente" && (
        <div className="mt-3">
          <UsoLinea datos={uso} uid={perfil.id} grande />
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-8">
          {perfil.role === "diseno" ? (
          <Section title="Lo que tiene que hacer ahora" description="Piezas pagadas o con cambios pedidos, de sus clientes.">
            {r.piezasEnCancha.length === 0 ? (
              <p className="rounded-xl border p-4 text-sm text-muted-foreground">Nada pendiente.</p>
            ) : (
              <ol className="divide-y rounded-xl border bg-card">
                {r.piezasEnCancha.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => navigate("/piezas")} className="w-full px-4 py-2.5 text-left hover:bg-muted/40">
                      <p className="line-clamp-1 text-sm font-medium">{p.pedido}</p>
                      <p className="text-xs text-muted-foreground">
                        {clienteById(p.proyecto_id)?.nombre} · {p.estado === "en_proceso" ? "diseñando" : "para hacer"}
                        {p.fecha_deseada ? ` · para el ${p.fecha_deseada.split("-").reverse().slice(0, 2).join("/")}` : ""}
                      </p>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Section>
          ) : perfil.role !== "administracion" && (
          <Section title="Lo que tiene que hacer ahora" description="Videos que están esperando a esta persona.">
            {r.enSuCancha.length === 0 ? (
              <p className="rounded-xl border p-4 text-sm text-muted-foreground">Nada pendiente.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {r.enSuCancha.map((v) => (
                  <VideoCard key={v.id} video={v} />
                ))}
              </div>
            )}
          </Section>
          )}
          <Section title="Actividad por semana">
            <div className="rounded-xl border bg-card p-4">
              <Barras semanas={r.semanas} />
            </div>
          </Section>
        </div>

        <Section title="Últimos movimientos">
          {r.recientes.length === 0 ? (
            <p className="rounded-xl border p-4 text-sm text-muted-foreground">Sin movimientos registrados.</p>
          ) : (
            <ol className="divide-y rounded-xl border bg-card">
              {r.recientes.map((e, i) => (
                <li key={i}>
                  <button type="button" onClick={() => (esPieza(e.videoId) ? navigate("/piezas") : openVideo(e.videoId))} className="w-full px-4 py-2.5 text-left hover:bg-muted/40">
                    <p className="text-sm font-medium">{e.accion}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.titulo} · {clienteById(e.proyectoId)?.nombre} · {fechaHora(e.at)}
                    </p>
                    {e.nota && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">“{e.nota}”</p>}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {clientesIds.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {clientesIds.map((id) => (
                <ClienteTag key={id} cliente={clienteById(id)} className="rounded-full border px-2 py-0.5" />
              ))}
            </div>
          )}
        </Section>
      </div>
    </PageShell>
  );
}
