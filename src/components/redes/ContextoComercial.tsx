import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Loader2, Package, Plus, Star, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { guardarComercial, useComercial, useMemoriaIA } from "@/lib/redes/planMes";
import { sumarDias } from "@/lib/fecha";
import { hoyISO } from "@/lib/redes/format";
import type { ContextoComercial, ProductoComercial, TemporadaComercial } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

const nid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Temporadas vigentes hoy o en los próximos 30 días. */
export function temporadasActivas(c: ContextoComercial | undefined, hoy = hoyISO()) {
  const en30 = sumarDias(hoy, 30);
  return (c?.temporadas ?? []).filter((t) => (!t.desde || t.desde <= en30) && (!t.hasta || t.hasta >= hoy));
}

/**
 * Contexto comercial del cliente para la IA: a quién le vende, qué cuenta como resultado,
 * sus productos (★ los que hay que empujar) y lo de temporada con fechas.
 * La IA lo usa en el plan del mes, los textos, los guiones y las piezas.
 */
export function ContextoComercialEditor({
  proyectoId,
  nombre,
  compacto = false,
  cliente = false,
  sugerido,
}: {
  proyectoId: string;
  nombre: string;
  compacto?: boolean;
  /** Lo carga el propio cliente desde su panel (textos en segunda persona). */
  cliente?: boolean;
  /** Lo que ya contó de su negocio (bienvenida): se ofrece como sugerencia si todavía no escribió nada acá. */
  sugerido?: string;
}) {
  const [guardado, setGuardado] = useComercial(proyectoId, cliente);
  const [c, setC] = useState<ContextoComercial>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dirty) setC({ ...(guardado ?? {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardado?.actualizado_at, guardado === undefined, proyectoId]);

  const set = (patch: Partial<ContextoComercial>) => {
    setC((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };
  const productos = c.productos ?? [];
  const temporadas = c.temporadas ?? [];
  const setProd = (id: string, patch: Partial<ProductoComercial>) =>
    set({ productos: productos.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const setTemp = (id: string, patch: Partial<TemporadaComercial>) =>
    set({ temporadas: temporadas.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const guardar = async () => {
    const malas = temporadas.filter((t) => t.desde && t.hasta && t.hasta < t.desde);
    if (malas.length) {
      toast.error(`“${malas[0].titulo || "Temporada"}”: la fecha “hasta” es antes que “desde”`);
      return;
    }
    setBusy(true);
    try {
      const r = await guardarComercial(proyectoId, c);
      if (cliente) setGuardado(r.comercial ?? c);
      setDirty(false);
      toast.success(cliente ? "¡Gracias! Con esto armamos tus videos y piezas" : "Listo: la IA ya lo tiene en cuenta");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  const hoy = hoyISO();
  const sugerencia = !c.enfoque?.trim() ? sugerido?.trim() : undefined;
  const vigente = (t: TemporadaComercial) => (!t.desde || t.desde <= hoy) && (!t.hasta || t.hasta >= hoy);

  return (
    <div className="space-y-5">
      <div className={cn("grid gap-4", !compacto && "lg:grid-cols-2")}>
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Target className="h-4 w-4 text-primary" /> {cliente ? "Tu negocio en pocas palabras" : "Enfoque comercial"}
          </p>
          <Textarea
            rows={5}
            value={c.enfoque ?? ""}
            onChange={(e) => set({ enfoque: e.target.value })}
            maxLength={2000}
            placeholder={
              sugerencia ||
              (cliente
                ? "A quién le vendés, qué es lo que más te consultan y qué te diferencia de la competencia. Ej.: familias de la zona; lo que más piden es el delivery de noche; nos eligen por la masa madre."
                : `A quién le vende ${nombre}, qué hace que le escriban y qué los diferencia de la competencia. Ej.: familias de la zona; lo que más consultan es el delivery de noche; ganamos por masa madre y horno a leña.`)
            }
          />
          {/* La sugerencia no se guarda sola: al usarla queda "sin guardar" y recién con Guardar le llega a la IA. */}
          {sugerencia && (
            <Button type="button" variant="outline" size="sm" onClick={() => set({ enfoque: sugerencia.slice(0, 2000) })}>
              {cliente ? "Usar lo que nos contaste" : "Usar sugerencia"}
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">{cliente ? "¿Qué querés conseguir?" : "Qué cuenta como resultado"}</p>
          <Input
            value={c.objetivo ?? ""}
            onChange={(e) => set({ objetivo: e.target.value })}
            maxLength={200}
            placeholder="Ej.: pedidos por WhatsApp, reservas, consultas para turnos, visitas al local"
          />
          <p className="text-xs text-muted-foreground">
            {cliente
              ? "Armamos los videos y las piezas para conseguir esto."
              : "La IA arma todo para conseguir esto: el gancho, el producto que muestra y el llamado a la acción."}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Package className="h-4 w-4 text-primary" /> Productos y servicios
          </p>
          <span className="text-xs text-muted-foreground">{cliente ? "★ = lo que más querés vender" : "★ = lo que hay que empujar"}</span>
        </div>
        {productos.length === 0 && (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            {cliente
              ? "Cargá lo que vendés, con precio si querés: así los videos y las piezas muestran tus productos reales."
              : "Cargá lo que vende: así la IA propone videos y piezas sobre productos reales y no inventa."}
          </p>
        )}
        {productos.map((p) => (
          <div key={p.id} className="flex flex-col gap-2 rounded-xl border bg-card p-2.5 sm:flex-row sm:items-start">
            <button
              type="button"
              onClick={() => setProd(p.id, { destacado: !p.destacado })}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
                p.destacado ? "border-amber-500/50 bg-amber-500/15 text-amber-500" : "text-muted-foreground hover:text-amber-500"
              )}
              aria-label={p.destacado ? "Quitar destacado" : "Destacar"}
              title="Destacar: la IA lo empuja más"
            >
              <Star className={cn("h-4 w-4", p.destacado && "fill-current")} />
            </button>
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1.2fr_0.6fr]">
              <Input value={p.nombre} onChange={(e) => setProd(p.id, { nombre: e.target.value })} placeholder="Producto o servicio" maxLength={120} />
              <Input value={p.precio ?? ""} onChange={(e) => setProd(p.id, { precio: e.target.value })} placeholder="Precio (opcional)" maxLength={60} />
              <Input
                className="sm:col-span-2"
                value={p.detalle ?? ""}
                onChange={(e) => setProd(p.id, { detalle: e.target.value })}
                placeholder="Qué tiene de bueno, para quién es (opcional)"
                maxLength={400}
              />
            </div>
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 self-end text-muted-foreground hover:text-destructive sm:self-start" onClick={() => set({ productos: productos.filter((x) => x.id !== p.id) })} aria-label="Quitar producto">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => set({ productos: [...productos, { id: nid(), nombre: "", destacado: false }] })}>
          <Plus className="mr-1.5 h-4 w-4" /> Agregar producto
        </Button>
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarRange className="h-4 w-4 text-primary" /> De temporada y promos
        </p>
        {temporadas.length === 0 && (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            Ej.: “Menú de invierno” de junio a agosto, “Promo Día de la Madre” del 1 al 19 de octubre. La IA lo usa solo en esas fechas.
          </p>
        )}
        {temporadas.map((t) => (
          <div key={t.id} className="space-y-2 rounded-xl border bg-card p-2.5">
            <div className="flex items-center gap-2">
              <Input value={t.titulo} onChange={(e) => setTemp(t.id, { titulo: e.target.value })} placeholder="Qué es" maxLength={120} />
              {t.titulo && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    vigente(t) ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                  )}
                >
                  {vigente(t) ? "Vigente" : t.desde && t.desde > hoy ? "Próxima" : "Pasó"}
                </span>
              )}
              <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => set({ temporadas: temporadas.filter((x) => x.id !== t.id) })} aria-label="Quitar">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[11px] text-muted-foreground">
                Desde
                <Input type="date" value={t.desde ?? ""} onChange={(e) => setTemp(t.id, { desde: e.target.value || null })} />
              </label>
              <label className="space-y-1 text-[11px] text-muted-foreground">
                Hasta
                <Input type="date" value={t.hasta ?? ""} onChange={(e) => setTemp(t.id, { hasta: e.target.value || null })} />
              </label>
            </div>
            <Input value={t.detalle ?? ""} onChange={(e) => setTemp(t.id, { detalle: e.target.value })} placeholder="Detalle (opcional): qué incluye, precio, condiciones" maxLength={400} />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => set({ temporadas: [...temporadas, { id: nid(), titulo: "", desde: null, hasta: null }] })}>
          <Plus className="mr-1.5 h-4 w-4" /> Agregar temporada o promo
        </Button>
      </div>

      <div className="barra-guardar sticky bottom-[var(--alto-barra)] z-10 flex items-center justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur">
        {dirty && <span className="text-xs text-muted-foreground">Sin guardar</span>}
        <Button onClick={() => void guardar()} disabled={busy || !dirty}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </div>
    </div>
  );
}

/** Resumen corto + botón para editar (en el plan del mes). */
export function ResumenComercial({ proyectoId, nombre }: { proyectoId: string; nombre: string }) {
  const m = useMemoriaIA(proyectoId);
  const [open, setOpen] = useState(false);
  const c = m?.comercial;
  const prods = c?.productos?.length ?? 0;
  const dest = c?.productos?.filter((p) => p.destacado).length ?? 0;
  const temp = useMemo(() => temporadasActivas(c), [c]);
  const vacio = !c?.enfoque && !prods && !(c?.temporadas?.length ?? 0);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors hover:border-primary/50",
          vacio && "border-dashed"
        )}
      >
        <Target className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Contexto comercial de {nombre}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {vacio
              ? "Sin cargar: contale a la IA qué vende y qué está de temporada"
              : `${prods} producto${prods === 1 ? "" : "s"}${dest ? ` (${dest} ★)` : ""} · ${temp.length ? `${temp.map((t) => t.titulo).join(", ")}` : "nada de temporada ahora"}`}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-primary">{vacio ? "Cargar" : "Editar"}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl pb-0">
          <DialogHeader>
            <DialogTitle>Contexto comercial · {nombre}</DialogTitle>
            <DialogDescription>Lo que vende y lo que está de temporada. La IA lo usa para que todo apunte a traer consultas y ventas.</DialogDescription>
          </DialogHeader>
          <ContextoComercialEditor proyectoId={proyectoId} nombre={nombre} compacto />
        </DialogContent>
      </Dialog>
    </>
  );
}
