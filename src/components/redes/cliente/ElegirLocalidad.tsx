// Dónde se filma: buscador + mapa. Reconquista en el centro, anillos de 15, 80 y 100 km y cada localidad
// en su lugar real (datos oficiales de Georef). Se elige tocando un punto o buscando por nombre.

import { useMemo, useState } from "react";
import { Check, MapPin, Search, X } from "lucide-react";
import { formatARS } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import {
  LOCALIDADES,
  RECONQUISTA,
  viaticoDe,
  zonaDe,
  type LocalidadViatico,
  type MontosViatico,
  type ZonaViatico,
} from "../../../../api/_lib/viaticos";

/** Color de cada zona (punto del mapa, anillo y etiqueta). */
const COLOR: Record<ZonaViatico, { punto: string; pill: string; anillo: string }> = {
  sin_cargo: { punto: "#10b981", pill: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", anillo: "#10b981" },
  hasta_80: { punto: "#8b5cf6", pill: "bg-violet-500/15 text-violet-600 dark:text-violet-300", anillo: "#8b5cf6" },
  hasta_100: { punto: "#f59e0b", pill: "bg-amber-500/15 text-amber-600 dark:text-amber-400", anillo: "#f59e0b" },
  cotizar: { punto: "#94a3b8", pill: "bg-muted text-muted-foreground", anillo: "#94a3b8" },
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Mapa: km a cada lado del centro que entran en el dibujo (un poco más que 100 km).
const RADIO_KM = 108;
const TAM = 300;
const aXY = (l: { la: number; lo: number }) => {
  const x = (l.lo - RECONQUISTA.lo) * Math.cos((RECONQUISTA.la * Math.PI) / 180) * 111.32;
  const y = -(l.la - RECONQUISTA.la) * 110.57;
  const k = TAM / 2 / RADIO_KM;
  return { x: TAM / 2 + x * k, y: TAM / 2 + y * k };
};
const radio = (km: number) => (km * TAM) / 2 / RADIO_KM;

export function ElegirLocalidad({
  valor,
  onCambiar,
  montos,
}: {
  valor: string;
  onCambiar: (localidad: string) => void;
  montos: MontosViatico | null | undefined;
}) {
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const elegida = LOCALIDADES.find((l) => l.n === valor) ?? null;
  const v = viaticoDe(montos, valor);

  const precio = (z: ZonaViatico) => {
    if (z === "sin_cargo") return "Sin cargo";
    const m = z === "hasta_80" ? montos?.hasta_80 : z === "hasta_100" ? montos?.hasta_100 : null;
    return m && m > 0 ? formatARS(m) : "A coordinar";
  };
  const textoZona = (l: LocalidadViatico) =>
    l.p !== "Santa Fe" ? "Cruzando el río" : { sin_cargo: "Sin viaje", hasta_80: "Hasta 80 km", hasta_100: "Hasta 100 km", cotizar: "Más lejos" }[zonaDe(l)];

  const resultados = useMemo(() => {
    const t = norm(q.trim());
    const lista = t ? LOCALIDADES.filter((l) => norm(l.n).includes(t) || norm(l.d).includes(t)) : LOCALIDADES;
    return lista.slice(0, t ? 12 : 8);
  }, [q]);

  const elegir = (n: string) => {
    onCambiar(n);
    setQ("");
    setBuscando(false);
  };

  return (
    <div className="space-y-3">
      {/* Elegida */}
      <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: COLOR[v.zona].punto }}>
          <MapPin className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{v.localidad}</p>
          <p className="text-xs text-muted-foreground">
            {v.km != null ? `${v.km} km de Reconquista` : "Fuera de la lista"}
            {elegida && elegida.p !== "Santa Fe" ? ` · ${elegida.p}` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", COLOR[v.zona].pill)}>
          {v.estado === "sin_cargo" ? "Sin cargo" : v.monto ? formatARS(v.monto) : "A coordinar"}
        </span>
      </div>

      {/* Buscador */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setBuscando(true);
          }}
          onFocus={() => setBuscando(true)}
          placeholder="Buscá la localidad (ej. Malabrigo)"
          className="h-11 w-full rounded-xl border bg-background pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
        />
        {(q || buscando) && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setBuscando(false);
            }}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Cerrar búsqueda"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {buscando ? (
        <div className="max-h-72 overflow-y-auto rounded-xl border bg-background p-1 animate-in fade-in">
          {resultados.map((l) => {
            const z = zonaDe(l);
            const sel = l.n === valor;
            return (
              <button
                key={`${l.p}-${l.n}`}
                type="button"
                onClick={() => elegir(l.n)}
                className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted", sel && "bg-primary/10")}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR[z].punto }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.n}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {l.km} km · {textoZona(l)}
                  </span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", COLOR[z].pill)}>{precio(z)}</span>
                {sel && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
          {resultados.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No está en la lista (más de 100 km).</p>}
          <button
            type="button"
            onClick={() => elegir("Otra localidad")}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR.cotizar.punto }} />
            <span className="flex-1">Otra localidad (más lejos)</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", COLOR.cotizar.pill)}>A coordinar</span>
          </button>
        </div>
      ) : (
        <Mapa valor={valor} onElegir={elegir} />
      )}
    </div>
  );
}

/** Mapa de la zona: anillos de distancia y un punto por localidad (tocá uno para elegirlo). */
function Mapa({ valor, onElegir }: { valor: string; onElegir: (n: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const puntos = useMemo(() => LOCALIDADES.map((l) => ({ l, ...aXY(l), z: zonaDe(l) })), []);
  const sel = puntos.find((p) => p.l.n === valor);
  const etiqueta = puntos.find((p) => p.l.n === (hover ?? valor));
  return (
    <div className="overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.10),transparent_70%)]">
      <svg viewBox={`0 0 ${TAM} ${TAM}`} className="mx-auto block w-full max-w-[22rem] touch-manipulation select-none" role="img" aria-label="Mapa de localidades alrededor de Reconquista">
        {/* Anillos: 100, 80 y 15 km */}
        {[
          { km: 100, c: COLOR.hasta_100.anillo, t: "100 km" },
          { km: 80, c: COLOR.hasta_80.anillo, t: "80 km" },
          { km: 15, c: COLOR.sin_cargo.anillo, t: "" },
        ].map((a) => (
          <g key={a.km}>
            <circle cx={TAM / 2} cy={TAM / 2} r={radio(a.km)} fill={a.c} fillOpacity={0.06} stroke={a.c} strokeOpacity={0.55} strokeDasharray="3 3" />
            {a.t && (
              <text x={TAM / 2} y={TAM / 2 - radio(a.km) + 10} textAnchor="middle" fontSize="8" fill={a.c} fontWeight={600}>
                {a.t}
              </text>
            )}
          </g>
        ))}
        {/* Río Paraná, aproximado: separa Santa Fe de Corrientes */}
        <path
          d={`M ${aXY({ la: -28.3, lo: -59.05 }).x} ${aXY({ la: -28.3, lo: -59.05 }).y} Q ${aXY({ la: -28.95, lo: -59.42 }).x} ${aXY({ la: -28.95, lo: -59.42 }).y} ${aXY({ la: -29.3, lo: -59.45 }).x} ${aXY({ la: -29.3, lo: -59.45 }).y} T ${aXY({ la: -30.05, lo: -59.62 }).x} ${aXY({ la: -30.05, lo: -59.62 }).y}`}
          fill="none"
          stroke="#38bdf8"
          strokeOpacity={0.45}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <text x={aXY({ la: -29.55, lo: -59.18 }).x} y={aXY({ la: -29.55, lo: -59.18 }).y} fontSize="7" fill="#38bdf8" fillOpacity={0.8}>
          Río Paraná
        </text>
        {/* Localidades */}
        {puntos.map((p) => {
          const elegido = p.l.n === valor;
          return (
            <g
              key={`${p.l.p}-${p.l.n}`}
              className="cursor-pointer"
              onClick={() => onElegir(p.l.n)}
              onPointerEnter={() => setHover(p.l.n)}
              onPointerLeave={() => setHover(null)}
            >
              {/* Zona más grande para tocar con el dedo */}
              <circle cx={p.x} cy={p.y} r={9} fill="transparent" />
              <circle cx={p.x} cy={p.y} r={elegido ? 5.5 : 3.6} fill={COLOR[p.z].punto} stroke="white" strokeWidth={elegido ? 2 : 1} />
            </g>
          );
        })}
        {/* Reconquista */}
        <g pointerEvents="none">
          <circle cx={TAM / 2} cy={TAM / 2} r={6} fill="hsl(var(--primary))" stroke="white" strokeWidth={2} />
        </g>
        {sel && (
          <circle cx={sel.x} cy={sel.y} r={9} fill="none" stroke={COLOR[sel.z].punto} strokeWidth={2} className="animate-ping" style={{ transformOrigin: `${sel.x}px ${sel.y}px` }} pointerEvents="none" />
        )}
        {etiqueta && (
          <g pointerEvents="none">
            <rect
              x={Math.min(TAM - 4 - (etiqueta.l.n.length * 4.6 + 10), Math.max(4, etiqueta.x - (etiqueta.l.n.length * 4.6 + 10) / 2))}
              y={etiqueta.y - 22}
              width={etiqueta.l.n.length * 4.6 + 10}
              height={14}
              rx={7}
              fill="hsl(var(--foreground))"
            />
            <text
              x={Math.min(TAM - 4 - (etiqueta.l.n.length * 4.6 + 10), Math.max(4, etiqueta.x - (etiqueta.l.n.length * 4.6 + 10) / 2)) + (etiqueta.l.n.length * 4.6 + 10) / 2}
              y={etiqueta.y - 12}
              textAnchor="middle"
              fontSize="8.5"
              fontWeight={600}
              fill="hsl(var(--background))"
            >
              {etiqueta.l.n}
            </text>
          </g>
        )}
      </svg>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-primary" /> Reconquista
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: COLOR.sin_cargo.punto }} /> Sin viaje
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: COLOR.hasta_80.punto }} /> Hasta 80 km
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: COLOR.hasta_100.punto }} /> Hasta 100 km
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: COLOR.cotizar.punto }} /> A coordinar
        </span>
      </div>
      <p className="pb-2 text-center text-[11px] text-muted-foreground">Tocá un punto del mapa o buscá arriba</p>
    </div>
  );
}
