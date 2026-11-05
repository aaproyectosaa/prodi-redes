import { useMemo, useState } from "react";
import { Factory, Loader2 } from "lucide-react";
import { VisitaFicha, VisitaTarjeta } from "@/components/redes/visitas/VisitaFicha";
import { useVisitas } from "@/lib/redes/visitas";
import { cn } from "@/lib/utils";
import type { Project } from "@/integrations/firebase/types";

/**
 * El dueño (cliente) mira las visitas que cargan sus vendedores: quién fue, a qué fábrica, qué filmó y si ya se hizo
 * video. Solo para mirar: editar y borrar queda para el vendedor y para Prodi.
 */
export function VisitasCliente({ cliente }: { cliente: Project }) {
  const ids = useMemo(() => [cliente.id], [cliente.id]);
  const { visitas, loading } = useVisitas(ids);
  const [vendedor, setVendedor] = useState<string>("todos");
  const [abierta, setAbierta] = useState<string | null>(null);

  const vendedores = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; n: number }>();
    for (const v of visitas) {
      const x = m.get(v.vendedor_id) ?? { id: v.vendedor_id, nombre: v.vendedor_nombre, n: 0 };
      x.n++;
      m.set(v.vendedor_id, x);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [visitas]);
  const lista = vendedor === "todos" ? visitas : visitas.filter((v) => v.vendedor_id === vendedor);
  const visita = visitas.find((v) => v.id === abierta) ?? null;
  const archivos = lista.reduce((n, v) => n + (v.archivos?.length ?? 0), 0);
  const conVideo = lista.filter((v) => v.video_id).length;

  if (loading)
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (!visitas.length)
    return (
      <div className="rounded-2xl border border-dashed p-6 text-center">
        <Factory className="mx-auto h-8 w-8 text-primary/60" />
        <p className="mt-2 font-semibold">Todavía no hay visitas</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Cuando tus vendedores carguen una visita desde el celular, acá vas a ver la fábrica, lo que contaron y los videos y fotos que filmaron.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[
          [lista.length, lista.length === 1 ? "visita" : "visitas"],
          [archivos, archivos === 1 ? "video o foto" : "videos y fotos"],
          [conVideo, conVideo === 1 ? "ya es video" : "ya son video"],
        ].map(([n, l]) => (
          <div key={String(l)} className="rounded-2xl border bg-card p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{n}</p>
            <p className="text-xs text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>

      {vendedores.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {[{ id: "todos", nombre: "Todos", n: visitas.length }, ...vendedores].map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setVendedor(x.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                vendedor === x.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {x.nombre} · {x.n}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {lista.map((v) => (
          <VisitaTarjeta key={v.id} v={v} onAbrir={() => setAbierta(v.id)} />
        ))}
      </div>

      <VisitaFicha visita={visita} open={!!visita} onOpenChange={(o) => !o && setAbierta(null)} puedeSubir={false} />
    </div>
  );
}
