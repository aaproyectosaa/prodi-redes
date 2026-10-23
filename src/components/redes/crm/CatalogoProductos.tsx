import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Globe, ImageOff, Loader2, Package, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callApi } from "@/lib/redes/api";
import { hace } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

// Catálogo de productos del CRM (api/_lib/catalogo.ts): se conecta pegando el link de la web del negocio (Tiendanube,
// Shopify, WooCommerce o cualquier tienda) o se cargan a mano, y desde el chat se eligen para mandarlos.
// negocio = "prodi" (el CRM de Prodi) o el id del cliente (su CRM). Este archivo es el mismo en los dos proyectos.

export interface Producto {
  id: string;
  nombre: string;
  precio: number | null;
  moneda: string;
  foto: string | null;
  url: string | null;
  stock: boolean | null;
  descripcion: string;
  origen: "web" | "manual";
}
interface Conexion {
  url: string;
  plataforma: string | null;
  cantidad: number;
  actualizado_at: string;
  error: string | null;
}

export const precioTexto = (p: Pick<Producto, "precio" | "moneda">) => {
  if (p.precio == null) return "";
  const m = (p.moneda ?? "").toUpperCase();
  return `${m && m !== "ARS" ? (m === "USD" ? "US$" : m) : "$"} ${p.precio.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
};

const PLATAFORMA: Record<string, string> = { shopify: "Shopify", woocommerce: "WooCommerce", web: "tu web" };

export function useCatalogo(negocio: string) {
  const [productos, setProductos] = useState<Producto[] | null>(null);
  const [conexion, setConexion] = useState<Conexion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      const r = await callApi<{ conexion: Conexion | null; productos: Producto[] }>("/api/publico/catalogo", { negocio });
      setProductos(r.productos);
      setConexion(r.conexion);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el catálogo");
      setProductos([]);
    }
  }, [negocio]);
  useEffect(() => {
    void cargar();
  }, [cargar]);
  return { productos, conexion, error, cargar };
}

function Foto({ p, className }: { p: Pick<Producto, "foto" | "nombre">; className?: string }) {
  const [fallo, setFallo] = useState(false);
  return p.foto && !fallo ? (
    <img src={p.foto} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFallo(true)} className={cn("object-cover", className)} />
  ) : (
    <span className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
      <ImageOff className="h-4 w-4" />
    </span>
  );
}

/** Para elegir productos y mandarlos desde el chat (uno o varios). */
export function SelectorProductos({
  negocio,
  onElegir,
  onCerrar,
  onConfigurar,
}: {
  negocio: string;
  onElegir: (productos: Producto[]) => void | Promise<void>;
  onCerrar?: () => void;
  onConfigurar?: () => void;
}) {
  const { productos, error } = useCatalogo(negocio);
  const [busca, setBusca] = useState("");
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [mandando, setMandando] = useState(false);
  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (productos ?? []).filter((p) => !q || `${p.nombre} ${p.descripcion}`.toLowerCase().includes(q));
  }, [productos, busca]);
  const alternar = (id: string) => setElegidos((l) => (l.includes(id) ? l.filter((x) => x !== id) : l.length >= 10 ? l : [...l, id]));
  const mandar = async () => {
    const lista = (productos ?? []).filter((p) => elegidos.includes(p.id));
    if (!lista.length) return;
    setMandando(true);
    try {
      await onElegir(lista);
      setElegidos([]);
    } finally {
      setMandando(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar producto…" className="h-8 rounded-full pl-8 text-xs" autoFocus />
        </div>
        {onConfigurar && (
          <button type="button" onClick={onConfigurar} className="rounded-md px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10">
            Catálogo
          </button>
        )}
        {onCerrar && (
          <button type="button" onClick={onCerrar} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {productos === null ? (
        <p className="flex items-center gap-2 px-1 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Abriendo el catálogo…
        </p>
      ) : error ? (
        <p className="px-1 py-3 text-xs text-amber-600">{error}</p>
      ) : !productos.length ? (
        <div className="flex flex-col items-center gap-2 py-5 text-center">
          <Package className="h-6 w-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Todavía no hay productos. Conectá la web de la tienda o cargalos a mano.</p>
          {onConfigurar && (
            <Button size="sm" className="h-8 rounded-full text-xs" onClick={onConfigurar}>
              <Globe className="mr-1.5 h-3.5 w-3.5" /> Conectar catálogo
            </Button>
          )}
        </div>
      ) : (
        <div className="grid max-h-60 grid-cols-3 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-4">
          {visibles.map((p) => {
            const sel = elegidos.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => alternar(p.id)}
                className={cn(
                  "relative flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-all",
                  sel ? "border-primary ring-2 ring-primary/40" : "hover:border-primary/40",
                  p.stock === false && "opacity-60"
                )}
              >
                <Foto p={p} className="h-16 w-full bg-white" />
                {sel && (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <span className="block p-1.5">
                  <span className="line-clamp-2 block text-[10.5px] font-medium leading-tight">{p.nombre}</span>
                  <span className="mt-0.5 flex items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-primary">{precioTexto(p)}</span>
                    {p.stock === false && <span className="text-[9px] font-semibold uppercase text-red-500">Sin stock</span>}
                  </span>
                </span>
              </button>
            );
          })}
          {!visibles.length && <p className="col-span-full py-4 text-center text-xs text-muted-foreground">Nada con «{busca}».</p>}
        </div>
      )}

      {elegidos.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/10 px-2.5 py-1.5">
          <span className="text-xs font-medium text-primary">
            {elegidos.length} producto{elegidos.length === 1 ? "" : "s"} elegido{elegidos.length === 1 ? "" : "s"}
          </span>
          <Button size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => void mandar()} disabled={mandando}>
            {mandando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mandar"}
          </Button>
        </div>
      )}
    </div>
  );
}

const VACIO = { id: "", nombre: "", precio: "", foto: "", url: "", descripcion: "" };

/** Conectar la web y administrar los productos del catálogo. */
export function ConfigCatalogo({ negocio }: { negocio: string }) {
  const { productos, conexion, cargar } = useCatalogo(negocio);
  const [url, setUrl] = useState("");
  const [conectando, setConectando] = useState(false);
  const [editando, setEditando] = useState<typeof VACIO | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  useEffect(() => {
    if (conexion?.url) setUrl(conexion.url.replace(/^https?:\/\//, ""));
  }, [conexion?.url]);

  const conectar = async () => {
    setConectando(true);
    try {
      const r = await callApi<{ plataforma: string; cantidad: number }>("/api/publico/catalogo-conectar", { negocio, url });
      toast.success(`Listo: ${r.cantidad} productos de ${PLATAFORMA[r.plataforma] ?? "la web"}`);
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo conectar");
    } finally {
      setConectando(false);
    }
  };
  const guardar = async () => {
    if (!editando) return;
    setGuardando(true);
    try {
      await callApi("/api/publico/catalogo-producto", { negocio, producto: { ...editando, id: editando.id || undefined } });
      setEditando(null);
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  const borrar = async (p: Producto) => {
    if (!window.confirm(`¿Sacar «${p.nombre}» del catálogo?`)) return;
    try {
      await callApi("/api/publico/catalogo-borrar", { negocio, id: p.id });
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo sacar");
    }
  };
  const lista = verTodos ? productos ?? [] : (productos ?? []).slice(0, 12);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Pegá el link de la tienda (Tiendanube, Shopify, WooCommerce o cualquier web): los productos se traen solos y se actualizan todos los días.</p>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="mitienda.com.ar" className="h-9 pl-8 text-sm" />
          </div>
          <Button size="sm" className="h-9 shrink-0" onClick={() => void conectar()} disabled={conectando || url.trim().length < 4}>
            {conectando ? <Loader2 className="h-4 w-4 animate-spin" /> : conexion?.url ? <RefreshCw className="h-4 w-4" /> : "Conectar"}
          </Button>
        </div>
        {conectando && <p className="text-[11px] text-muted-foreground">Leyendo la tienda… puede tardar hasta un minuto.</p>}
        {conexion && !conectando && (
          <p className={cn("text-[11px]", conexion.error ? "text-amber-600" : "text-muted-foreground")}>
            {conexion.error ? conexion.error : `${conexion.cantidad} productos de ${PLATAFORMA[conexion.plataforma ?? ""] ?? "la web"} · actualizado ${hace(conexion.actualizado_at)}`}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Productos {productos ? `(${productos.length})` : ""}</p>
        <button type="button" onClick={() => setEditando({ ...VACIO })} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
          <Plus className="h-3 w-3" /> Agregar a mano
        </button>
      </div>

      {editando && (
        <div className="space-y-1.5 rounded-xl border border-primary/40 bg-primary/[0.04] p-2">
          <Input value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} placeholder="Nombre del producto" className="h-8 text-xs" autoFocus />
          <div className="grid grid-cols-2 gap-1.5">
            <Input value={editando.precio} onChange={(e) => setEditando({ ...editando, precio: e.target.value })} placeholder="Precio (ej. 12500)" inputMode="decimal" className="h-8 text-xs" />
            <Input value={editando.url} onChange={(e) => setEditando({ ...editando, url: e.target.value })} placeholder="Link para comprar" className="h-8 text-xs" />
          </div>
          <Input value={editando.foto} onChange={(e) => setEditando({ ...editando, foto: e.target.value })} placeholder="Link de la foto (opcional)" className="h-8 text-xs" />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-7 rounded-full text-xs" onClick={() => void guardar()} disabled={guardando}>
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
            </Button>
          </div>
        </div>
      )}

      {productos === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : (
        <div className="space-y-1">
          {lista.map((p) => (
            <div key={p.id} className="group flex items-center gap-2 rounded-lg border bg-card p-1.5">
              <Foto p={p} className="h-9 w-9 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{p.nombre}</p>
                <p className="text-[11px] text-muted-foreground">
                  {precioTexto(p) || "Sin precio"}
                  {p.stock === false ? " · sin stock" : ""}
                  {p.origen === "manual" ? " · a mano" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditando({ id: p.id, nombre: p.nombre, precio: p.precio != null ? String(p.precio) : "", foto: p.foto ?? "", url: p.url ?? "", descripcion: p.descripcion })}
                className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100"
                aria-label="Editar"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => void borrar(p)} className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-red-500 group-hover:opacity-100" aria-label="Sacar">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {(productos?.length ?? 0) > 12 && (
            <button type="button" onClick={() => setVerTodos(!verTodos)} className="text-[11px] font-medium text-primary hover:underline">
              {verTodos ? "Ver menos" : `Ver los ${productos!.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
