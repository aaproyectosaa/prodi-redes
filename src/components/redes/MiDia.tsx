import { ArrowRight, CalendarClock, CheckCircle2, Sun } from "lucide-react";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { hoyISO } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

export interface ItemDia {
  id: string;
  titulo: string;
  clienteId: string;
  /** Para cuándo (YYYY-MM-DD…), o null si no tiene fecha. */
  fecha: string | null | undefined;
  /** Qué hay que hacer ("Editar", "Revisar", "Publicar"…). */
  tarea: string;
  onAbrir: () => void;
}

const CUANTOS = 4;

/** "Vencido", "Hoy", "Mañana" o el día. */
function cuando(fecha: string | null | undefined): { texto: string; tono: "rojo" | "naranja" | "normal" } {
  if (!fecha) return { texto: "Sin fecha", tono: "normal" };
  const f = fecha.slice(0, 10);
  const hoy = hoyISO();
  const manana = hoyISO(Date.now() + 86_400_000);
  if (f < hoy) return { texto: "Vencido", tono: "rojo" };
  if (f === hoy) return { texto: "Hoy", tono: "naranja" };
  if (f === manana) return { texto: "Mañana", tono: "normal" };
  return { texto: `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`, tono: "normal" };
}

/**
 * "Mi día": lo más urgente de cada uno arriba de su tablero, para que no tenga que buscar qué hacer.
 * Recibe lo que le toca a la persona y muestra las primeras, ordenadas por fecha (sin fecha, al final).
 */
export function MiDia({ items }: { items: ItemDia[] }) {
  const { clienteById } = useRedes();
  const { profile } = useUserProfileContext();
  const nombre = (profile?.nombre ?? "").split(" ")[0];
  const ordenados = [...items].sort((a, b) => (a.fecha || "9999").localeCompare(b.fecha || "9999"));
  const primeros = ordenados.slice(0, CUANTOS);
  const resto = ordenados.length - primeros.length;
  const h = new Date().getHours();
  const saludo = h < 13 ? "Buen día" : h < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <section className="mb-5 overflow-hidden rounded-3xl border bg-card">
      <div className="flex items-center gap-3 border-b bg-gradient-to-r from-primary/10 via-fuchsia-500/5 to-transparent px-4 py-3 sm:px-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white">
          <Sun className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">
            {saludo}
            {nombre ? `, ${nombre}` : ""} 👋
          </p>
          <p className="text-xs text-muted-foreground">
            {items.length ? `Lo más urgente de hoy${items.length > CUANTOS ? ` (${items.length} en total)` : ""}` : "No tenés nada pendiente"}
          </p>
        </div>
      </div>
      {primeros.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" /> Estás al día. ¡Bien ahí!
        </p>
      ) : (
        <ol className="divide-y">
          {primeros.map((it, i) => {
            const c = cuando(it.fecha);
            return (
              <li key={it.id}>
                <button type="button" onClick={it.onAbrir} className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 sm:px-5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{it.titulo}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <ClienteTag cliente={clienteById(it.clienteId)} />
                      <span className="shrink-0">· {it.tarea}</span>
                    </span>
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      c.tono === "rojo" ? "bg-destructive/10 text-destructive" : c.tono === "naranja" ? "bg-warning/20 text-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <CalendarClock className="h-3 w-3" /> {c.texto}
                  </span>
                  <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {resto > 0 && <p className="border-t px-5 py-2 text-xs text-muted-foreground">y {resto} más en tu tablero ↓</p>}
    </section>
  );
}
