import { useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Lo mínimo de una empresa para elegirla. */
export interface EmpresaElegible {
  id: string;
  nombre: string;
  color?: string | null;
}

/** Sin tildes ni mayúsculas: "alfonsína" encuentra "ALFONSINA". */
const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Círculo con la inicial y el color de la empresa. */
function Inicial({ e, grande }: { e: EmpresaElegible; grande?: boolean }) {
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-lg font-bold text-white", grande ? "h-8 w-8 text-sm" : "h-6 w-6 text-[11px]")}
      style={{ background: e.color || "#6F40FC" }}
    >
      {e.nombre.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * Buscador de empresa: se toca, se escribe parte del nombre (sin importar tildes) y se elige con un toque o con
 * las flechas y Enter. Reemplaza las listas largas para elegir cliente.
 * `opciones` suma lo que no es una empresa (ej. "Todos los clientes", "Reunión interna") arriba de la lista.
 */
export function ElegirCliente({
  value,
  onChange,
  clientes,
  opciones = [],
  placeholder = "Elegí la empresa",
  className,
  icono = true,
  disabled,
  detalle,
}: {
  value: string;
  onChange: (id: string) => void;
  clientes: EmpresaElegible[];
  opciones?: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  /** El ícono de edificio a la izquierda (cuando no hay una empresa elegida). */
  icono?: boolean;
  disabled?: boolean;
  /** Algo más al lado de cada empresa en la lista (ej. el estado de su plan del mes). */
  detalle?: (id: string) => React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [activo, setActivo] = useState(0);
  const elegido = clientes.find((c) => c.id === value);
  const opcion = opciones.find((o) => o.value === value);

  const ordenados = useMemo(() => [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [clientes]);
  const filtrados = useMemo(() => {
    const t = normal(q.trim());
    if (!t) return ordenados;
    // Primero los que empiezan con lo escrito, después los que lo tienen en el medio.
    const empieza = ordenados.filter((c) => normal(c.nombre).startsWith(t) || normal(c.nombre).split(/\s+/).some((p) => p.startsWith(t)));
    const contiene = ordenados.filter((c) => !empieza.includes(c) && normal(c.nombre).includes(t));
    return [...empieza, ...contiene];
  }, [ordenados, q]);
  const extras = q.trim() ? opciones.filter((o) => normal(o.label).includes(normal(q.trim()))) : opciones;
  const lista: { value: string; label: string; empresa?: EmpresaElegible }[] = [
    ...extras.map((o) => ({ value: o.value, label: o.label })),
    ...filtrados.map((c) => ({ value: c.id, label: c.nombre, empresa: c })),
  ];

  const elegir = (v: string) => {
    onChange(v);
    setAbierto(false);
    setQ("");
  };

  /** Resalta lo que se buscó dentro del nombre. */
  const resaltar = (texto: string) => {
    const t = normal(q.trim());
    if (!t) return texto;
    const i = normal(texto).indexOf(t);
    if (i < 0) return texto;
    return (
      <>
        {texto.slice(0, i)}
        <mark className="rounded bg-primary/20 px-0.5 text-foreground">{texto.slice(i, i + t.length)}</mark>
        {texto.slice(i + t.length)}
      </>
    );
  };

  return (
    <Popover
      open={abierto}
      onOpenChange={(o) => {
        setAbierto(o);
        if (o) {
          setQ("");
          setActivo(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border bg-background px-3 text-left text-sm transition-colors hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            abierto && "border-primary ring-2 ring-primary/20",
            className
          )}
        >
          {elegido ? <Inicial e={elegido} /> : icono && <Building2 className="h-4 w-4 shrink-0 text-primary" />}
          <span className={cn("min-w-0 flex-1 truncate", !elegido && !opcion && "text-muted-foreground")}>{elegido?.nombre ?? opcion?.label ?? placeholder}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActivo(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActivo((a) => Math.min(a + 1, lista.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActivo((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && lista[activo]) {
                e.preventDefault();
                elegir(lista[activo].value);
              }
            }}
            placeholder="Buscar empresa…"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} className="rounded-full p-1 text-muted-foreground hover:bg-muted" aria-label="Borrar búsqueda">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {lista.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No hay ninguna empresa con “{q}”.</p>
          ) : (
            lista.map((it, n) => {
              const sel = it.value === value;
              return (
                <button
                  key={it.value}
                  type="button"
                  onMouseEnter={() => setActivo(n)}
                  onClick={() => elegir(it.value)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
                    n === activo ? "bg-accent" : "hover:bg-accent/60",
                    sel && "font-semibold"
                  )}
                >
                  {it.empresa ? (
                    <Inicial e={it.empresa} />
                  ) : (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{it.empresa ? resaltar(it.label) : it.label}</span>
                  {it.empresa && detalle?.(it.value)}
                  {sel && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>
        {clientes.length > 8 && (
          <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            {q.trim() ? `${filtrados.length} de ${clientes.length} empresas` : `${clientes.length} empresas · escribí para buscar`}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
