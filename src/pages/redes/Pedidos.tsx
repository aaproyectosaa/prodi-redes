import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, Clapperboard, ImageIcon, Inbox, MapPin } from "lucide-react";
import { PageShell } from "@/components/redes/PageShell";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { etapaInfo } from "@/lib/redes/etapas";
import { formatoInfo } from "@/lib/redes/piezas";
import { DIAS_PEDIDOS, marcarVistoPedidos, usePedidosClientes, type PedidoCliente } from "@/lib/redes/pedidosClientes";
import { cn } from "@/lib/utils";

/** "hace 5 min", "hace 3 h", "ayer", "hace 4 días". */
function haceCuanto(at: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

const fechaCorta = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;

/**
 * Bandeja de pedidos de los clientes (videos y piezas): lo que pidieron en los últimos días, lo nuevo arriba
 * y resaltado. Al abrirla se marca como visto (el número rojo del menú se apaga).
 */
export default function Pedidos() {
  const { user } = useUserProfileContext();
  const uid = user?.uid ?? "";
  const { lista, corte } = usePedidosClientes();
  const { loading } = useRedes();
  // Lo que era nuevo al entrar sigue resaltado mientras esté en la pantalla.
  const corteAlEntrar = useRef(corte);
  const nuevos = lista.filter((p) => p.at > corteAlEntrar.current);
  const anteriores = lista.filter((p) => p.at <= corteAlEntrar.current);

  useEffect(() => {
    if (!uid) return;
    const t = window.setTimeout(() => marcarVistoPedidos(uid), 1500);
    return () => window.clearTimeout(t);
  }, [uid, lista.length]);

  return (
    <PageShell title="Pedidos de clientes" subtitle={`Videos y piezas que pidieron los clientes desde su panel (últimos ${DIAS_PEDIDOS} días).`}>
      {loading && lista.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted/60" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Inbox className="h-7 w-7" />
          </span>
          <p className="font-semibold">Todavía no hay pedidos</p>
          <p className="max-w-sm text-sm text-muted-foreground">Cuando un cliente pida un video o una pieza desde su panel, aparece acá.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {nuevos.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-destructive">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
                </span>
                Nuevos · {nuevos.length}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {nuevos.map((p) => (
                  <Tarjeta key={p.tipo + p.id} p={p} nuevo />
                ))}
              </div>
            </section>
          )}
          {anteriores.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{nuevos.length ? "Anteriores" : "Últimos pedidos"}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {anteriores.map((p) => (
                  <Tarjeta key={p.tipo + p.id} p={p} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </PageShell>
  );
}

function Tarjeta({ p, nuevo }: { p: PedidoCliente; nuevo?: boolean }) {
  const navigate = useNavigate();
  const { clienteById } = useRedes();
  const esVideo = p.tipo === "video";
  const titulo = esVideo ? p.video.titulo : `${formatoInfo(p.pieza.formato).label}: ${p.pieza.producto || p.pieza.pedido}`;
  const detalle = esVideo ? p.video.idea : p.tipo === "pieza" && p.pieza.producto ? p.pieza.pedido : null;
  const fecha = esVideo ? p.video.fecha_deseada : p.pieza.fecha_deseada;

  // Chips: si entra en el plan o se paga aparte, cómo se filma y dónde está ahora.
  const chips: { texto: string; clase: string; icono?: React.ElementType }[] = [];
  if (esVideo) {
    const v = p.video;
    chips.push(v.extra ? { texto: "Video extra", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300" } : { texto: "Del plan", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" });
    if (v.filma_cliente) chips.push({ texto: "Lo filma el cliente", clase: "bg-sky-500/15 text-sky-700 dark:text-sky-300" });
    else if (v.material_base?.tipo === "existente") chips.push({ texto: "Con material cargado", clase: "bg-sky-500/15 text-sky-700 dark:text-sky-300" });
    if (v.viatico && v.viatico.estado !== "sin_cargo")
      chips.push({ texto: `${v.viatico.localidad}${v.viatico.km != null ? ` · ${v.viatico.km} km` : ""}`, clase: "bg-violet-500/15 text-violet-700 dark:text-violet-300", icono: MapPin });
    chips.push({ texto: etapaInfo(v.etapa).label, clase: "bg-muted text-muted-foreground" });
  } else {
    const pz = p.pieza;
    chips.push(
      pz.incluida
        ? { texto: "Del plan", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
        : pz.estado === "pendiente_pago"
          ? { texto: "Aparte · sin pagar", clase: "bg-destructive/10 text-destructive" }
          : { texto: "Aparte · pagada", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300" }
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate(esVideo ? `/videos?video=${p.id}` : `/piezas?pieza=${p.id}`)}
      className={cn(
        "group flex w-full items-start gap-3 rounded-2xl border bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
        nuevo && "border-destructive/50 bg-destructive/[0.04] shadow-sm shadow-destructive/10"
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm",
          esVideo ? "from-[#6F40FC] to-[#E040A0]" : "from-pink-500 to-rose-600"
        )}
      >
        {esVideo ? <Clapperboard className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex items-center gap-2">
          <ClienteTag cliente={clienteById(p.clienteId)} />
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{haceCuanto(p.at)}</span>
          {nuevo && <span className="shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Nuevo</span>}
        </span>
        <span className="block font-semibold leading-snug">{titulo}</span>
        {detalle && <span className="line-clamp-2 block text-xs text-muted-foreground">{detalle}</span>}
        <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {fecha && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">
              <CalendarClock className="h-3 w-3" /> Para el {fechaCorta(fecha)}
            </span>
          )}
          {chips.map((c) => (
            <span key={c.texto} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", c.clase)}>
              {c.icono && <c.icono className="h-3 w-3" />}
              {c.texto}
            </span>
          ))}
        </span>
      </span>
      <ArrowRight className="mt-3 hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
    </button>
  );
}
