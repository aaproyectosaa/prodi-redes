import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Eye, MessageCircle } from "lucide-react";
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
import { eventos, reporteUsuario, type ReporteUsuario } from "@/lib/redes/reportes";
import { fechaHora, hace, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { getRoleInfo } from "@/lib/roles";
import { cn } from "@/lib/utils";

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
  const { videos, rodajes, reuniones } = useRedes();
  const { profiles } = useAppData();
  const [mes, setMes] = useState(mesActual());
  const todos = useMemo(() => eventos(videos), [videos]);

  const equipo = profiles
    .filter((p) => ["productor", "editor", "pauta"].includes(p.role ?? ""))
    .map((p) => reporteUsuario(p, videos, rodajes, reuniones, mes, todos));
  const clientes = profiles
    .filter((p) => p.role === "cliente")
    .map((p) => reporteUsuario(p, videos, rodajes, reuniones, mes, todos));

  return (
    <PageShell title="Reportes" subtitle="Qué hizo cada persona y cómo viene rindiendo." actions={<MesSelect mes={mes} setMes={setMes} />}>
      <Section title="Equipo">
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
                <KpiGrid r={r} />
                <div className="flex items-end justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    <p>
                      <span className="text-lg font-bold text-foreground">{r.enSuCancha.length}</span> videos en su cancha
                    </p>
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
  const { videos, rodajes, reuniones, clienteById } = useRedes();
  const { profiles } = useAppData();
  const { realUser } = useUserProfileContext();
  const { entrar } = useVerComo();
  const openVideo = useOpenVideo();
  const [mes, setMes] = useState(mesActual());
  const perfil = profiles.find((p) => p.id === uid);
  if (!perfil) {
    return (
      <PageShell title="Reporte">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </PageShell>
    );
  }
  const r = reporteUsuario(perfil, videos, rodajes, reuniones, mes);
  const susClientes = videos
    .filter((v) => [v.productor_id, v.editor_id, v.pauta_id].includes(perfil.id))
    .map((v) => v.proyecto_id);
  const clientesIds = Array.from(new Set(susClientes));

  return (
    <PageShell
      title={
        <span className="flex items-center gap-3">
          <button type="button" onClick={() => navigate("/reportes")} className="text-muted-foreground hover:text-foreground" aria-label="Volver">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <UserAvatar profile={perfil} size="md" />
          {perfil.nombre}
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
              navigate(`/chat?c=${id}`);
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

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-8">
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
                  <button type="button" onClick={() => openVideo(e.videoId)} className="w-full px-4 py-2.5 text-left hover:bg-muted/40">
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
