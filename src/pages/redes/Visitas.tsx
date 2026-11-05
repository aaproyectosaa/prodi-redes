import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Factory, Loader2, Plus } from "lucide-react";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useRedes } from "@/contexts/redes-data-context";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { VisitaFicha, VisitaForm, VisitaTarjeta } from "@/components/redes/visitas/VisitaFicha";
import { useVisitas } from "@/lib/redes/visitas";
import { cn } from "@/lib/utils";

/**
 * Visitas de vendedores.
 * - Vendedor del cliente: un botón grande «Nueva visita» y abajo las visitas de su empresa (las de todos, con su nombre).
 * - Producción y super admin: las visitas de los clientes con el módulo prendido, para armar los videos.
 */
export default function Visitas() {
  const { role } = useUserProfileContext();
  return role === "vendedor" ? <PanelVendedor /> : <VisitasEquipo />;
}

function PanelVendedor() {
  const { user, profile } = useUserProfileContext();
  const empresa = (profile as { proyecto_id?: string } | null)?.proyecto_id ?? null;
  const { visitas, loading } = useVisitas(empresa ? [empresa] : profile ? [] : null);
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "mias">("todas");
  const visita = visitas.find((v) => v.id === abierta) ?? null;
  const lista = filtro === "mias" ? visitas.filter((v) => v.vendedor_id === user?.uid) : visitas;

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 pb-10 pt-5">
      <div>
        <p className="text-sm text-muted-foreground">Hola {profile?.nombre?.split(" ")[0] ?? ""} 👋</p>
        <h1 className="text-2xl font-bold">Visitas a fábricas</h1>
      </div>

      <button
        type="button"
        onClick={() => setNueva(true)}
        disabled={!empresa}
        className="flex w-full items-center justify-center gap-3 rounded-3xl bg-gradient-to-br from-primary via-violet-600 to-fuchsia-500 px-5 py-7 text-white shadow-xl shadow-primary/30 transition-transform active:scale-[0.99] disabled:opacity-60"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
          <Plus className="h-7 w-7" />
        </span>
        <span className="text-left">
          <span className="block text-xl font-bold">Nueva visita</span>
          <span className="block text-sm text-white/85">Título, fábrica y después la cámara</span>
        </span>
      </button>
      {!empresa && profile && <p className="text-center text-sm text-destructive">Tu usuario no está asociado a ninguna empresa. Avisale a Prodi.</p>}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Visitas del equipo</h2>
          <div className="inline-flex rounded-full bg-muted p-0.5 text-xs font-medium">
            {(
              [
                ["todas", "Todas"],
                ["mias", "Las mías"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFiltro(k)} className={cn("rounded-full px-3 py-1", filtro === k ? "bg-background shadow-sm" : "text-muted-foreground")}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : lista.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-6 text-center">
            <Factory className="mx-auto h-8 w-8 text-primary/60" />
            <p className="mt-2 text-sm text-muted-foreground">{filtro === "mias" ? "Todavía no cargaste visitas." : "Todavía no hay visitas cargadas."}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lista.map((v) => (
              <VisitaTarjeta key={v.id} v={v} mia={v.vendedor_id === user?.uid} onAbrir={() => setAbierta(v.id)} />
            ))}
          </div>
        )}
      </div>

      <VisitaForm open={nueva} onOpenChange={setNueva} onCreada={(id) => setAbierta(id)} />
      <VisitaFicha visita={visita} open={!!visita} onOpenChange={(o) => !o && setAbierta(null)} puedeSubir={visita?.vendedor_id === user?.uid} />
    </div>
  );
}

function VisitasEquipo() {
  const { clientes } = useRedes();
  const openVideo = useOpenVideo();
  const [params, setParams] = useSearchParams();
  const conVisitas = useMemo(() => clientes.filter((c) => c.visitas_activo), [clientes]);
  const ids = useMemo(() => conVisitas.map((c) => c.id), [conVisitas]);
  const { visitas, loading } = useVisitas(ids);
  const [cliente, setCliente] = useState<string>("todos");
  const [estado, setEstado] = useState<"todas" | "sin_video" | "con_video">("sin_video");
  const [abierta, setAbierta] = useState<string | null>(null);

  // Desde el aviso: /visitas?visita=<id>
  const desdeLink = params.get("visita");
  useEffect(() => {
    if (!desdeLink) return;
    setAbierta(desdeLink);
    setEstado("todas");
    const next = new URLSearchParams(params);
    next.delete("visita");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desdeLink]);

  const nombre = (pid: string) => conVisitas.find((c) => c.id === pid)?.nombre ?? "";
  const lista = visitas
    .filter((v) => cliente === "todos" || v.proyecto_id === cliente)
    .filter((v) => (estado === "sin_video" ? !v.video_id && (v.archivos?.length ?? 0) > 0 : estado === "con_video" ? !!v.video_id : true));
  const visita = visitas.find((v) => v.id === abierta) ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-10 pt-5">
      <div>
        <h1 className="text-2xl font-bold">Visitas de vendedores</h1>
        <p className="text-sm text-muted-foreground">Lo que filman los vendedores de los clientes en sus visitas. Armá el video con el material de cada una.</p>
      </div>

      {conVisitas.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Ningún cliente tiene las visitas de vendedores prendidas. Se prenden en la ficha del cliente → «Vendedores y visitas».
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {conVisitas.length > 1 && (
              <select value={cliente} onChange={(e) => setCliente(e.target.value)} className="h-9 rounded-full border bg-background px-3 text-sm">
                <option value="todos">Todos los clientes</option>
                {conVisitas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            )}
            <div className="inline-flex rounded-full bg-muted p-0.5 text-xs font-medium">
              {(
                [
                  ["sin_video", "Para armar"],
                  ["con_video", "Ya armadas"],
                  ["todas", "Todas"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setEstado(k)} className={cn("rounded-full px-3 py-1.5", estado === k ? "bg-background shadow-sm" : "text-muted-foreground")}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : lista.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {estado === "sin_video" ? "No hay visitas nuevas para armar." : "No hay visitas con este filtro."}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {lista.map((v) => (
                <VisitaTarjeta key={v.id} v={v} cliente={conVisitas.length > 1 ? nombre(v.proyecto_id) : undefined} onAbrir={() => setAbierta(v.id)} />
              ))}
            </div>
          )}
        </>
      )}

      <VisitaFicha
        visita={visita}
        open={!!visita}
        onOpenChange={(o) => !o && setAbierta(null)}
        puedeSubir={false}
        equipo
        onVerVideo={(id) => {
          setAbierta(null);
          window.setTimeout(() => openVideo(id), 150);
        }}
      />
    </div>
  );
}
