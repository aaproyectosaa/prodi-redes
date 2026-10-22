import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Buscar la ubicación de un local: se escribe la dirección o el nombre del lugar y aparecen sugerencias del mapa
// (OpenStreetMap, sin clave); al elegir una se ve en el mapa de Google. También acepta pegar un link de Google Maps.

/** Link para abrir la ubicación en Google Maps (si es un link, ese; si es una dirección, la búsqueda). */
export const linkMapa = (u: string) => (/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(u.trim())}`);

/** Mapa de Google para mostrar adentro (sin clave). Los links cortos (maps.app.goo.gl) no se pueden mostrar: solo abrir. */
export function mapaEmbebido(u: string): string | null {
  const t = u.trim();
  let q = t;
  if (/^https?:\/\//i.test(t)) {
    const lugar = t.match(/\/place\/([^/@?]+)/)?.[1];
    const coords = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const param = (() => {
      try {
        const p = new URL(t).searchParams;
        return p.get("q") ?? p.get("query");
      } catch {
        return null;
      }
    })();
    q = coords ? `${coords[1]},${coords[2]}` : lugar ? decodeURIComponent(lugar.replace(/\+/g, " ")) : (param ?? "");
  }
  return q.length > 3 ? `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : null;
}

interface Sugerencia {
  id: number;
  titulo: string;
  detalle: string;
  valor: string;
}

/** Dirección corta y legible a partir de lo que devuelve OpenStreetMap. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aSugerencia(r: any): Sugerencia {
  const a = r.address ?? {};
  const calle = [a.road ?? a.pedestrian ?? a.footway, a.house_number].filter(Boolean).join(" ");
  const ciudad = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? "";
  const titulo = r.name || calle || String(r.display_name).split(",")[0];
  const detalle = [r.name && calle ? calle : "", ciudad, a.state].filter(Boolean).join(", ");
  return { id: r.place_id, titulo, detalle, valor: [r.name, calle, ciudad, a.state].filter(Boolean).filter((x, i, l) => l.indexOf(x) === i).join(", ") };
}

export function BuscadorMapa({
  valor,
  onCambiar,
  onEnter,
  className,
  autoFocus,
}: {
  valor: string;
  onCambiar: (v: string) => void;
  onEnter?: () => void;
  className?: string;
  autoFocus?: boolean;
}) {
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  // Lo que eligió de la lista no se vuelve a buscar.
  const elegido = useRef<string | null>(null);

  useEffect(() => {
    const q = valor.trim();
    if (q.length < 4 || /^https?:/i.test(q) || q === elegido.current) {
      setSugerencias([]);
      return;
    }
    const ctrl = new AbortController();
    // Esperar a que deje de escribir (el servicio pide no más de un pedido por segundo).
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=ar&limit=5&accept-language=es&q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const lista = (await r.json()) as unknown[];
        setSugerencias(lista.map(aSugerencia));
        setAbierto(true);
      } catch {
        /* sin sugerencias: igual se puede guardar lo escrito */
      } finally {
        setBuscando(false);
      }
    }, 700);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [valor]);

  const mapa = valor.trim().length > 3 ? mapaEmbebido(valor) : null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={valor}
          onChange={(e) => {
            elegido.current = null;
            onCambiar(e.target.value);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder="Buscá la dirección o el local (o pegá el link de Maps)"
          className="h-11 rounded-xl pl-9 pr-9"
          maxLength={300}
          autoFocus={autoFocus}
        />
        {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        {abierto && sugerencias.length > 0 && (
          <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-popover shadow-lg">
            {sugerencias.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  elegido.current = s.valor;
                  onCambiar(s.valor);
                  setSugerencias([]);
                  setAbierto(false);
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.titulo}</span>
                  {s.detalle && <span className="block truncate text-xs text-muted-foreground">{s.detalle}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {mapa && <iframe title="Mapa" src={mapa} className="h-40 w-full rounded-xl border" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
      <a
        href={valor.trim() ? linkMapa(valor) : "https://www.google.com/maps"}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
      >
        ¿No aparece? Buscalo en Google Maps y pegá el link acá
      </a>
    </div>
  );
}
