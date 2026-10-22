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

type Coords = [number, number];

/** Coordenadas escritas en el texto o en un link de Google Maps (@lat,lng o q=lat,lng). */
function coordsDe(u: string): Coords | null {
  const m = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? u.match(/(?:^|[=\s])(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Dónde queda una dirección (OpenStreetMap). Se guarda en el navegador para no volver a buscarla. */
async function coordenadas(u: string): Promise<Coords | null> {
  const directas = coordsDe(u);
  if (directas) return directas;
  let q = u.trim();
  if (/^https?:\/\//i.test(q)) {
    const lugar = q.match(/\/place\/([^/@?]+)/)?.[1];
    if (!lugar) return null;
    q = decodeURIComponent(lugar.replace(/\+/g, " "));
  }
  const clave = `geo:${q.toLowerCase()}`;
  try {
    const guardado = localStorage.getItem(clave);
    if (guardado) return JSON.parse(guardado) as Coords | null;
  } catch {
    /* sin almacenamiento */
  }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ar&q=${encodeURIComponent(q)}`);
    const [x] = (await r.json()) as { lat: string; lon: string }[];
    const c: Coords | null = x ? [Number(x.lat), Number(x.lon)] : null;
    try {
      localStorage.setItem(clave, JSON.stringify(c));
    } catch {
      /* sin almacenamiento */
    }
    return c;
  } catch {
    return null;
  }
}

/** Mapa que se mueve y se acerca ahí mismo (Leaflet con OpenStreetMap). Si no encuentra el lugar, muestra el de Google. */
export function MapaMovible({ ubicacion, className }: { ubicacion: string; className?: string }) {
  const caja = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<"cargando" | "ok" | "sin">("cargando");
  useEffect(() => {
    let cancelado = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mapa: any = null;
    setEstado("cargando");
    void (async () => {
      const c = await coordenadas(ubicacion);
      if (cancelado) return;
      if (!c) return setEstado("sin");
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelado || !caja.current) return;
      mapa = L.map(caja.current, { scrollWheelZoom: true }).setView(c, 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapa);
      L.marker(c, {
        icon: L.divIcon({
          className: "",
          html: '<div style="width:22px;height:22px;border-radius:9999px 9999px 9999px 0;transform:rotate(-45deg);background:#6F40FC;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 22],
        }),
      }).addTo(mapa);
      setEstado("ok");
      // En un diálogo que se está abriendo, el tamaño se acomoda después.
      setTimeout(() => mapa?.invalidateSize(), 250);
    })();
    return () => {
      cancelado = true;
      mapa?.remove();
    };
  }, [ubicacion]);

  if (estado === "sin") {
    const g = mapaEmbebido(ubicacion);
    return g ? <iframe title="Mapa" src={g} className={cn("w-full rounded-xl border", className)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : null;
  }
  return (
    <div className={cn("relative isolate overflow-hidden rounded-xl border", className)}>
      <div ref={caja} className="h-full w-full" />
      {estado === "cargando" && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/60 text-xs text-muted-foreground">
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Buscando en el mapa…
        </div>
      )}
    </div>
  );
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

  // El mapa se actualiza cuando deja de escribir (o al elegir una sugerencia).
  const [paraMapa, setParaMapa] = useState(valor.trim());
  useEffect(() => {
    const t = setTimeout(() => setParaMapa(valor.trim()), valor.trim() === elegido.current ? 0 : 1200);
    return () => clearTimeout(t);
  }, [valor]);

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
      {paraMapa.length > 3 && <MapaMovible ubicacion={paraMapa} className="h-44" />}
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
