import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Copy, Globe, ImageOff, Loader2, Package, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callApi } from "@/lib/redes/api";
import { hace } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

// Catálogo de productos del CRM (api/_lib/catalogo.ts): se conecta la web PROPIA del negocio (Tiendanube, Shopify,
// WooCommerce o cualquier tienda) o se cargan a mano, y desde el chat se eligen para mandarlos. Si el cliente pega una
// web que no es la de su ficha, se comprueba sola (su Instagram/Facebook, su mail o un código que pone en la web); si
// no puede, se lo pide a Prodi.
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
  url?: string;
  plataforma?: string | null;
  cantidad?: number;
  actualizado_at?: string;
  error?: string | null;
  /** Web que pidió conectar el cliente y espera que el admin la confirme. */
  pendiente?: { host: string; por_nombre?: string; at: string } | null;
  rechazada?: { host: string; at: string } | null;
  /** Cómo se comprobó que la web es del negocio (ficha, Instagram/Facebook, mail, código o Prodi). */
  web_verificada?: { host: string; detalle: string; at: string } | null;
}
interface Catalogo {
  conexion: Conexion | null;
  productos: Producto[];
  /** La web de la ficha del cliente (la carga Prodi) y la que aprobó el admin: esas se conectan sin esperar. */
  web_ficha?: string | null;
  web_aprobada?: string | null;
}

/** "https://www.MiTienda.com.ar/x" → "mitienda.com.ar". */
const hostDe = (u: string) => {
  try {
    return new URL(/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
/** Una vez por día, al abrir el catálogo, se vuelve a leer la tienda (el servidor decide si hace falta). */
const VIEJO_MS = 20 * 3_600_000;

export const precioTexto = (p: Pick<Producto, "precio" | "moneda">) => {
  if (p.precio == null) return "";
  const m = (p.moneda ?? "").toUpperCase();
  return `${m && m !== "ARS" ? (m === "USD" ? "US$" : m) : "$"} ${p.precio.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
};

const PLATAFORMA: Record<string, string> = { shopify: "Shopify", woocommerce: "WooCommerce", web: "tu web" };

export function useCatalogo(negocio: string) {
  const [productos, setProductos] = useState<Producto[] | null>(null);
  const [datos, setDatos] = useState<Omit<Catalogo, "productos">>({ conexion: null });
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      const r = await callApi<Catalogo>("/api/publico/catalogo", { negocio });
      setProductos(r.productos);
      setDatos({ conexion: r.conexion, web_ficha: r.web_ficha ?? null, web_aprobada: r.web_aprobada ?? null });
      setError(null);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el catálogo");
      setProductos([]);
      return null;
    }
  }, [negocio]);
  useEffect(() => {
    let vivo = true;
    void cargar().then((r) => {
      // Si la tienda se leyó hace más de un día, se actualiza sola (sin esperar).
      const at = r?.conexion?.actualizado_at ? Date.parse(r.conexion.actualizado_at) : 0;
      if (!vivo || !r?.conexion?.url || Date.now() - at < VIEJO_MS) return;
      callApi("/api/publico/catalogo-conectar", { negocio, auto: true })
        .then(() => vivo && void cargar())
        .catch(() => undefined);
    });
    return () => {
      vivo = false;
    };
  }, [cargar, negocio]);
  return { productos, conexion: datos.conexion, webFicha: datos.web_ficha ?? null, webAprobada: datos.web_aprobada ?? null, error, cargar };
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
  const { productos, conexion, webFicha, webAprobada, cargar } = useCatalogo(negocio);
  const [url, setUrl] = useState("");
  const [declaro, setDeclaro] = useState(false);
  const [conectando, setConectando] = useState(false);
  // Si hay que comprobar la web: el código para poner y, si no puede, pedírselo a Prodi.
  const [verificar, setVerificar] = useState<{ host: string; codigo: string } | null>(null);
  const [pedirAProdi, setPedirAProdi] = useState(false);
  const [editando, setEditando] = useState<typeof VACIO | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  // Se sugiere la web ya conectada o la de su ficha.
  useEffect(() => {
    const sugerida = conexion?.url ?? webAprobada ?? webFicha;
    if (sugerida) setUrl(sugerida.replace(/^https?:\/\//, ""));
  }, [conexion?.url, webAprobada, webFicha]);
  const host = hostDe(url);
  useEffect(() => {
    // Si cambia la web, se arranca de nuevo.
    setVerificar((v) => (v && v.host !== host ? null : v));
    setPedirAProdi(false);
  }, [host]);

  type Respuesta = { plataforma?: string; cantidad?: number; pendiente?: boolean; verificar?: boolean; host?: string; codigo?: string };
  const listo = async (r: Respuesta) => {
    if (r.verificar && r.host && r.codigo) {
      setVerificar({ host: r.host, codigo: r.codigo });
      return;
    }
    if (r.pendiente) toast.success("Listo: cuando Prodi confirme que la web es tuya, se conecta sola");
    else toast.success(`Listo: ${r.cantidad ?? 0} productos de ${PLATAFORMA[r.plataforma ?? ""] ?? "la web"}`);
    setVerificar(null);
    setPedirAProdi(false);
    setDeclaro(false);
    await cargar();
  };
  const pedir = async (ruta: string, extra: Record<string, unknown> = {}) => {
    setConectando(true);
    try {
      await listo(await callApi<Respuesta>(ruta, { negocio, url, ...extra }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo conectar");
    } finally {
      setConectando(false);
    }
  };
  const conectar = () => pedir("/api/publico/catalogo-conectar");
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
        <p className="text-xs text-muted-foreground">
          Conectá la web de tu tienda (Tiendanube, Shopify, WooCommerce o la tuya): los productos se traen solos y se actualizan una vez por día. Solo se puede
          conectar la web de tu negocio.
        </p>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="mitienda.com.ar" className="h-9 pl-8 text-sm" />
          </div>
          <Button size="sm" className="h-9 shrink-0" onClick={() => void conectar()} disabled={conectando || !host}>
            {conectando ? <Loader2 className="h-4 w-4 animate-spin" /> : conexion?.url && hostDe(conexion.url) === host ? <RefreshCw className="h-4 w-4" /> : "Conectar"}
          </Button>
        </div>
        {verificar && !pedirAProdi && (
          <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/[0.05] p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" /> Comprobá que {verificar.host} es tuya
            </p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Poné este código en cualquier parte visible de tu web: el pie de página, «Sobre nosotros» o la descripción de un producto. Cuando esté publicado, tocá
              «Ya lo puse». Después lo podés borrar.
            </p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 rounded-lg border bg-background px-2.5 py-1.5 text-center font-mono text-sm font-bold tracking-wider">{verificar.codigo}</code>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => void navigator.clipboard?.writeText(verificar.codigo).then(() => toast.success("Código copiado"))}
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setPedirAProdi(true)} className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline">
                No puedo ponerlo: pedírselo a Prodi
              </button>
              <Button size="sm" className="h-8 rounded-full" onClick={() => void pedir("/api/publico/catalogo-verificar")} disabled={conectando}>
                {conectando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ya lo puse"}
              </Button>
            </div>
          </div>
        )}
        {verificar && pedirAProdi && (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-2.5">
            <label className="flex items-start gap-2 text-[11px] leading-snug">
              <input type="checkbox" checked={declaro} onChange={(e) => setDeclaro(e.target.checked)} className="mt-0.5 accent-primary" />
              <span>
                <b>{verificar.host}</b> es la web de mi negocio y tengo derecho a usar sus fotos y precios. Prodi lo confirma antes de conectarla.
              </span>
            </label>
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setPedirAProdi(false)}>
                Volver al código
              </Button>
              <Button size="sm" className="h-8 rounded-full" onClick={() => void pedir("/api/publico/catalogo-conectar", { declaro: true })} disabled={conectando || !declaro}>
                Pedírselo a Prodi
              </Button>
            </div>
          </div>
        )}
        {conexion?.web_verificada && hostDe(conexion.web_verificada.host) === host && !verificar && (
          <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" /> Web comprobada: {conexion.web_verificada.detalle}
          </p>
        )}
        {conexion?.pendiente && (
          <p className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <Clock className="h-3.5 w-3.5 shrink-0" /> Esperando que Prodi confirme que <b>{conexion.pendiente.host}</b> es tu web.
          </p>
        )}
        {conexion?.rechazada && !conexion.pendiente && hostDe(conexion.rechazada.host) === host && (
          <p className="rounded-lg bg-red-500/10 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">Prodi no pudo confirmar que {conexion.rechazada.host} sea tu web. Escribinos por el chat.</p>
        )}
        {conectando && <p className="text-[11px] text-muted-foreground">Leyendo la tienda… puede tardar hasta un minuto.</p>}
        {conexion?.actualizado_at && !conectando && (
          <p className={cn("text-[11px]", conexion.error ? "text-amber-600" : "text-muted-foreground")}>
            {conexion.error ? conexion.error : conexion.actualizado_at ? `${conexion.cantidad ?? 0} productos de ${PLATAFORMA[conexion.plataforma ?? ""] ?? "la web"} · actualizado ${hace(conexion.actualizado_at)}` : ""}
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
            <Input value={editando.url} onChange={(e) => setEditando({ ...editando, url: e.target.value })} placeholder="Link en tu web (opcional)" className="h-8 text-xs" />
          </div>
          <Input value={editando.foto} onChange={(e) => setEditando({ ...editando, foto: e.target.value })} placeholder="Link de la foto en tu web (opcional)" className="h-8 text-xs" />
          <p className="text-[10px] text-muted-foreground">La foto y el link tienen que ser de tu web.</p>
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

/** En la ficha del cliente (admin): la web que pidió conectar al catálogo, para confirmar que es suya o rechazarla. */
export function WebCatalogoPendiente({ negocio }: { negocio: string }) {
  const { conexion, webFicha, cargar } = useCatalogo(negocio);
  const [busy, setBusy] = useState(false);
  const p = conexion?.pendiente;
  if (!p) return null;
  const resolver = async (aprobar: boolean) => {
    setBusy(true);
    try {
      const r = await callApi<{ cantidad?: number }>("/api/publico/catalogo-web", { negocio, aprobar });
      toast.success(aprobar ? `Web aprobada: ${r.cantidad ?? 0} productos` : "Web rechazada");
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-2.5">
      <p className="text-sm">
        Pidió conectar <b>{p.host}</b> a su catálogo{p.por_nombre ? ` (${p.por_nombre})` : ""}.
      </p>
      <p className="text-[11px] text-muted-foreground">
        No la pudo comprobar solo (ni por su Instagram/Facebook, su mail o el código). Confirmá que la web es de este cliente antes de aprobar: se van a
        traer sus fotos y precios. {webFicha ? `En su ficha figura ${webFicha}.` : "No tiene web cargada en la ficha."}
      </p>
      <div className="flex gap-2">
        <a href={`https://${p.host}`} target="_blank" rel="noopener noreferrer" className="flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted">
          <Globe className="h-3.5 w-3.5" /> Ver la web
        </a>
        <Button size="sm" className="h-8" onClick={() => void resolver(true)} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Es suya, aprobar"}
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={() => void resolver(false)} disabled={busy}>
          Rechazar
        </Button>
      </div>
    </div>
  );
}
