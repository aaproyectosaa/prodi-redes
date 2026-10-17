import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, ChevronRight, Clock, Gauge, ImageIcon, Link2Off, Loader2, RefreshCw, Target, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { FilaKpis, Kpi } from "@/components/redes/admin/AdminUI";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { db } from "@/integrations/firebase/client";
import { doc, updateDoc } from "@/lib/db";
import { auditoriaPauta, DIAS_PARA_PUBLICAR, DIAS_RESULTADOS } from "@/lib/redes/auditoriaPauta";
import { mesActual, mesLabel } from "@/lib/redes/format";
import { assertEditable } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";

// "Mi rendimiento" de quien sube y pauta: lo que depende de él y puede arreglar (sus pendientes con días, sus números
// contra la meta y contra sus meses anteriores, y sus faltas). No ve a sus compañeros, ni horarios, ni el resumen del admin.

const fh = (h: number | null) => (h === null ? "—" : h < 24 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1).replace(".", ",")} días`);

export const METAS_PAUTA = [
  { icono: Clock, texto: `Todo lo aprobado por el cliente se publica en menos de ${DIAS_PARA_PUBLICAR * 24} h.` },
  { icono: Link2Off, texto: "Todo video pautado tiene cargado su ID del anuncio de Meta." },
  { icono: RefreshCw, texto: `Las pautas activas tienen resultados de los últimos ${DIAS_RESULTADOS} días.` },
];

export function MiRendimientoPauta() {
  const { user, profile } = useUserProfileContext();
  const { videos, piezas, clientes } = useRedes();
  const [abierto, setAbierto] = useState(false);
  const mes = mesActual();
  const uid = user?.uid ?? "";
  const a = useMemo(() => auditoriaPauta(uid, videos, piezas, clientes, mes, ""), [uid, videos, piezas, clientes, mes]);
  if (!uid) return null;
  const actual = a.meses[a.meses.length - 1];
  const viejos = a.esperando.filter((x) => x.dias > DIAS_PARA_PUBLICAR).length;
  const enMeta = actual.tarda === null || actual.tarda <= DIAS_PARA_PUBLICAR * 24;
  const todoBien = !a.faltas.total && !viejos && !a.sinMeta.length && !a.resultadosViejos.length;
  const aceptadas = !!profile?.metas_pauta_aceptadas_at;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn(
          "mb-4 flex w-full flex-wrap items-center gap-3 rounded-2xl border p-3 text-left transition-colors hover:border-primary/50 sm:p-4",
          todoBien ? "border-emerald-500/30 bg-emerald-500/[0.05]" : "border-red-500/40 bg-red-500/[0.05]"
        )}
      >
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white", todoBien ? "from-emerald-400 to-teal-600" : "from-red-500 to-rose-600")}>
          <Gauge className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Mi rendimiento · {mesLabel(mes).split(" ")[0]}</span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className={viejos ? "font-semibold text-red-600 dark:text-red-400" : ""}>
              {a.esperando.length} para publicar{viejos ? ` (${viejos} pasados de ${DIAS_PARA_PUBLICAR * 24} h)` : ""}
            </span>
            <span className={enMeta ? "" : "font-semibold text-red-600 dark:text-red-400"}>Tardás {fh(actual.tarda)} (meta {DIAS_PARA_PUBLICAR * 24} h)</span>
            <span className={a.faltas.total ? "font-semibold text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
              {a.faltas.total} falta{a.faltas.total === 1 ? "" : "s"} este mes
            </span>
          </span>
        </span>
        {!aceptadas && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">Leé las metas</span>}
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-2xl gap-0 overflow-y-auto rounded-3xl p-0">
          <DialogHeader className="space-y-1 border-b bg-gradient-to-r from-primary/[0.08] to-fuchsia-500/[0.05] px-5 pb-4 pt-5 text-left">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Gauge className="h-5 w-5 text-primary" /> Mi rendimiento
            </DialogTitle>
            <DialogDescription>Lo que tenés pendiente y cómo venís con las metas este mes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 p-5">
            <Metas aceptadas={aceptadas} uid={uid} />

            <FilaKpis className="lg:grid-cols-2">
              <Kpi icono={Check} label="Publicados" valor={String(actual.publicados)} sub={`en ${mesLabel(mes).split(" ")[0].toLowerCase()}`} tono="violeta" />
              <Kpi icono={Clock} label="Tardás en publicar" valor={fh(actual.tarda)} sub={`meta: menos de ${DIAS_PARA_PUBLICAR * 24} h`} tono={enMeta ? "verde" : "rojo"} />
              <Kpi icono={TriangleAlert} label="Publicados tarde" valor={String(a.tarde.length)} sub="después de la fecha del cliente" tono={a.tarde.length ? "rojo" : "verde"} />
              <Kpi icono={Target} label="Faltas del mes" valor={String(a.faltas.total)} sub={a.faltas.total ? "incumplimientos de las metas" : "¡Vas bien!"} tono={a.faltas.total ? "rojo" : "verde"} />
            </FilaKpis>

            {a.faltas.total > 0 && (
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  { n: a.faltas.esperando, t: `Aprobados esperando +${DIAS_PARA_PUBLICAR * 24} h` },
                  { n: a.faltas.lentos, t: `Publicados después de ${DIAS_PARA_PUBLICAR * 24} h` },
                  { n: a.faltas.sinMeta, t: "Pautados sin ID de Meta" },
                  { n: a.faltas.resultados, t: `Resultados de +${DIAS_RESULTADOS} días` },
                ].map((x) => (
                  <div key={x.t} className={cn("rounded-xl border p-2.5", x.n ? "border-red-500/40 bg-red-500/[0.05]" : "")}>
                    <p className={cn("text-lg font-bold tabular-nums", x.n && "text-red-600 dark:text-red-400")}>{x.n}</p>
                    <p className="text-muted-foreground">{x.t}</p>
                  </div>
                ))}
              </div>
            )}

            <Pendientes a={a} onIr={() => setAbierto(false)} />

            {/* Contra sí mismo: sus últimos meses */}
            <div className="rounded-2xl border bg-card p-4">
              <p className="mb-3 text-sm font-semibold">Tus últimos meses</p>
              <div className="flex h-28 gap-2">
                {a.meses.map((m, i) => {
                  const max = Math.max(1, ...a.meses.map((x) => x.publicados));
                  return (
                    <div key={m.mes} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
                      <span className="text-xs font-bold tabular-nums">{m.publicados}</span>
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className={cn("w-full rounded-t-lg", i === a.meses.length - 1 ? "bg-gradient-to-t from-[#6F40FC] to-[#E040A0]" : "bg-primary/30")}
                          style={{ height: `${Math.max(4, (m.publicados / max) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] uppercase text-muted-foreground">{mesLabel(m.mes).slice(0, 3)}</span>
                      <span className="text-[10px] text-muted-foreground">{fh(m.tarda)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Videos publicados por mes y, abajo, cuánto tardaste en promedio.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Las metas, siempre a la vista. La primera vez se aceptan con "Entendido" (queda registrado). */
function Metas({ aceptadas, uid }: { aceptadas: boolean; uid: string }) {
  const [guardando, setGuardando] = useState(false);
  const aceptar = async () => {
    setGuardando(true);
    try {
      assertEditable();
      await updateDoc(doc(db, "profiles", uid), { metas_pauta_aceptadas_at: new Date().toISOString() });
      toast.success("¡Gracias! Quedan a la vista acá.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className={cn("rounded-2xl border p-4", aceptadas ? "bg-muted/30" : "border-primary/40 bg-primary/[0.06]")}>
      <p className="mb-2 flex items-center gap-2 text-sm font-bold">
        <Target className="h-4 w-4 text-primary" /> Las metas
      </p>
      <ul className="space-y-1.5 text-sm">
        {METAS_PAUTA.map((m) => (
          <li key={m.texto} className="flex items-start gap-2">
            <m.icono className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> {m.texto}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Cada vez que algo no cumple una meta cuenta como una falta del mes.</p>
      {!aceptadas && (
        <Button className="mt-3 w-full sm:w-auto" onClick={aceptar} disabled={guardando}>
          {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Entendido
        </Button>
      )}
    </div>
  );
}

/** Sus pendientes, con días y un toque para resolverlos. */
function Pendientes({ a, onIr }: { a: ReturnType<typeof auditoriaPauta>; onIr: () => void }) {
  const { clientes } = useRedes();
  const openVideo = useOpenVideo();
  const navigate = useNavigate();
  const cliente = (id: string) => clientes.find((c) => c.id === id);
  const filas: { key: string; rojo: boolean; icono: React.ElementType; cliente?: string; titulo: string; que: string; ir: () => void }[] = [
    ...a.esperando.map(({ video, dias }) => ({
      key: `e${video.id}`,
      rojo: dias > DIAS_PARA_PUBLICAR,
      icono: Clock,
      cliente: video.proyecto_id,
      titulo: video.titulo,
      que: dias === 0 ? "Publicar · aprobado hoy" : `Publicar · aprobado hace ${dias} días`,
      ir: () => openVideo(video.id),
    })),
    ...a.sinMeta.map((video) => ({ key: `m${video.id}`, rojo: true, icono: Link2Off, cliente: video.proyecto_id, titulo: video.titulo, que: "Cargar el ID del anuncio de Meta", ir: () => openVideo(video.id) })),
    ...a.resultadosViejos.map(({ video, dias }) => ({
      key: `r${video.id}`,
      rojo: true,
      icono: RefreshCw,
      cliente: video.proyecto_id,
      titulo: video.titulo,
      que: dias === null ? "Cargar resultados (nunca se cargaron)" : `Actualizar resultados (hace ${dias} días)`,
      ir: () => openVideo(video.id),
    })),
    ...a.piezasSinPublicar.map(({ pieza, dias }) => ({
      key: `p${pieza.id}`,
      rojo: dias > DIAS_PARA_PUBLICAR,
      icono: ImageIcon,
      cliente: pieza.proyecto_id,
      titulo: pieza.producto || pieza.pedido,
      que: `Publicar pieza · aprobada hace ${dias} días`,
      ir: () => navigate(`/piezas?pieza=${pieza.id}`),
    })),
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Para hacer {filas.length ? `(${filas.length})` : ""}</p>
      {filas.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-3 text-sm">
          <Check className="h-4 w-4 text-emerald-500" /> No tenés nada pendiente. ¡Bien ahí!
        </p>
      ) : (
        filas.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              onIr();
              f.ir();
            }}
            className={cn("flex w-full items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left text-sm hover:border-primary/50", f.rojo && "border-red-500/40 bg-red-500/[0.04]")}
          >
            <f.icono className={cn("h-4 w-4 shrink-0", f.rojo ? "text-red-500" : "text-muted-foreground")} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <ClienteTag cliente={f.cliente ? cliente(f.cliente) : undefined} />
              </span>
              <span className="block truncate font-medium">{f.titulo}</span>
              <span className={cn("block text-xs", f.rojo ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground")}>{f.que}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))
      )}
    </div>
  );
}
