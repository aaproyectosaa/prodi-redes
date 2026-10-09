import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Gift, ImagePlus, Loader2, Megaphone, Receipt, Search, ShoppingBag, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LogoCliente } from "@/components/redes/LogoCliente";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useDriveConnection } from "@/hooks/use-drive-connection";
import { useDriveUploadContext } from "@/contexts/drive-upload-context";
import { FORMATOS, cupoPiezas, iconoFormato, pedirPiezaEquipo, precioDe } from "@/lib/redes/piezas";
import { formatARS, hoyISO, mesActual } from "@/lib/redes/format";
import type { EnfoquePieza, FormatoPieza } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * "Nueva pieza" desde el equipo: cliente, fotos para usar, qué pieza y qué hay que hacer. Si al cliente no le
 * quedan piezas del plan se elige sin cargo o que la pague él. Las fotos quedan en la pieza (las ve diseño y
 * las usa la IA al generarla).
 */
export function NuevaPiezaEquipo({ open, onOpenChange, onCreada }: { open: boolean; onOpenChange: (v: boolean) => void; onCreada: (id: string) => void }) {
  const { clientes, planes, piezas, settings } = useRedes();
  const { user } = useUserProfileContext();
  const { connection } = useDriveConnection();
  const { enqueueUpload } = useDriveUploadContext();
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [fotos, setFotos] = useState<{ file: File; url: string }[]>([]);
  const [formato, setFormato] = useState<FormatoPieza>("posteo_vertical");
  const [enfoque, setEnfoque] = useState<EnfoquePieza>("comercial");
  const [pedido, setPedido] = useState("");
  const [texto, setTexto] = useState("");
  const [mas, setMas] = useState(false);
  const [producto, setProducto] = useState("");
  const [oferta, setOferta] = useState("");
  const [cta, setCta] = useState("");
  const [fecha, setFecha] = useState("");
  const [fuera, setFuera] = useState<"sin_cargo" | "cobrar">("sin_cargo");
  const [enviando, setEnviando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setClienteId(clientes.length === 1 ? clientes[0].id : null);
    setBusca("");
    setFotos([]);
    setFormato("posteo_vertical");
    setEnfoque("comercial");
    setPedido("");
    setTexto("");
    setMas(false);
    setProducto("");
    setOferta("");
    setCta("");
    setFecha("");
    setFuera("sin_cargo");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Las vistas previas se liberan al cerrar.
  useEffect(() => {
    if (!open) fotos.forEach((f) => URL.revokeObjectURL(f.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cliente = clientes.find((c) => c.id === clienteId);
  const lista = useMemo(() => {
    const q = normal(busca.trim());
    return clientes.filter((c) => !q || normal(c.nombre).includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [clientes, busca]);
  const cupo = cliente ? cupoPiezas(cliente, planes, piezas, mesActual()) : null;
  const entra = !!cupo && cupo.quedan > 0;
  const precio = precioDe(settings, formato);
  const listo = !!cliente && (pedido.trim().length >= 10 || (enfoque === "comercial" && producto.trim().length > 1));

  const sumarFotos = (files: FileList | File[] | null) => {
    const nuevas = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!nuevas.length) return;
    setFotos((xs) => [...xs, ...nuevas.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 8));
  };

  const cargar = async () => {
    if (!cliente || !listo) return;
    if (fotos.length && connection?.status !== "connected") {
      toast.error("Drive no está conectado: no se pueden subir las fotos.");
      return;
    }
    setEnviando(true);
    try {
      const datos = {
        formato,
        enfoque,
        pedido: pedido.trim() || `${producto.trim()}${oferta.trim() ? ` · ${oferta.trim()}` : ""}`,
        texto_en_pieza: texto.trim() || null,
        producto: producto.trim() || null,
        oferta: oferta.trim() || null,
        cta: cta.trim() || null,
        fecha_deseada: fecha || null,
      };
      const r = await pedirPiezaEquipo(cliente.id, datos, entra ? undefined : fuera);
      if (r.estado === "sin_cupo") {
        toast.error("Ya no le quedan piezas del plan: elegí sin cargo o que la pague el cliente.");
        return;
      }
      // Las fotos se suben en segundo plano (se ve el progreso abajo) y quedan en la pieza.
      if (fotos.length && connection) {
        void enqueueUpload(
          {
            taskId: r.pieza_id,
            collectionName: "piezas_ia",
            slot: "crudo",
            connection,
            projectName: cliente.nombre,
            taskTipo: "Piezas",
            taskFecha: hoyISO(),
            uploaderUid: user?.uid ?? null,
            taskLabel: `Fotos · ${producto.trim() || "pieza"}`,
          },
          fotos.map((f) => f.file)
        );
      }
      toast.success(r.estado === "pendiente_cliente" ? "Cargada: le avisamos al cliente para que la pague" : "¡Pieza cargada! Le avisamos a diseño");
      onOpenChange(false);
      onCreada(r.pieza_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cargar");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !enviando && onOpenChange(v)}>
      <DialogContent className="flex max-h-[94dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <div className="relative overflow-hidden bg-gradient-to-br from-[#6F40FC] via-[#8B5CF6] to-[#E040A0] px-6 py-5 text-white">
          <span className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
          <DialogTitle className="relative flex items-center gap-2 text-xl font-bold">
            <Sparkles className="h-5 w-5" /> Nueva pieza
          </DialogTitle>
          <DialogDescription className="relative text-sm text-white/85">Cargala con las fotos y le llega a diseño al toque.</DialogDescription>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* 1. Cliente */}
          <Paso n={1} titulo="¿Para qué cliente?">
            {clientes.length > 6 && (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente…" className="h-9 pl-9" />
              </div>
            )}
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto p-0.5">
              {lista.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setClienteId(c.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-all hover:-translate-y-0.5",
                    clienteId === c.id ? "border-primary bg-primary text-primary-foreground shadow-md" : "bg-card hover:border-primary/50"
                  )}
                >
                  <LogoCliente cliente={c} className="h-7 w-7" />
                  <span className="max-w-[10rem] truncate font-medium">{c.nombre}</span>
                  {clienteId === c.id && <Check className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          </Paso>

          {/* 2. Fotos */}
          <Paso n={2} titulo="Fotos para usar" ayuda="Opcional · el producto, el local o la persona. Diseño las ve y la IA las usa tal cual.">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastrando(false);
                sumarFotos(e.dataTransfer.files);
              }}
              className={cn("rounded-2xl border-2 border-dashed p-3 transition-colors", arrastrando ? "border-primary bg-primary/5" : "border-muted-foreground/25")}
            >
              <div className="flex flex-wrap gap-2">
                {fotos.map((f, i) => (
                  <div key={f.url} className="group relative h-20 w-20 overflow-hidden rounded-xl border bg-muted animate-in fade-in zoom-in-95">
                    <img src={f.url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setFotos((xs) => xs.filter((_, j) => j !== i))}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Sacar foto"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  className="flex h-20 min-w-20 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <ImagePlus className="h-5 w-5" />
                  {fotos.length ? "Sumar más" : "Tocá o arrastrá las fotos acá"}
                </button>
              </div>
              <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => (sumarFotos(e.target.files), (e.target.value = ""))} />
            </div>
          </Paso>

          {/* 3. Qué pieza */}
          <Paso n={3} titulo="¿Qué pieza?">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FORMATOS.map((f) => {
                const dim = iconoFormato(f.ratio, 26);
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFormato(f.value)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all hover:-translate-y-0.5",
                      formato === f.value ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-card hover:border-primary/50"
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                      <span className={cn("rounded-[3px] border-2", formato === f.value ? "border-primary bg-primary/20" : "border-muted-foreground/50")} style={dim} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{f.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{f.medida}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl bg-muted/60 p-1">
              {(
                [
                  { v: "comercial", t: "Para vender", i: ShoppingBag },
                  { v: "institucional", t: "Para comunicar", i: Megaphone },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setEnfoque(o.v)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-all",
                    enfoque === o.v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <o.i className="h-4 w-4" /> {o.t}
                </button>
              ))}
            </div>
          </Paso>

          {/* 4. Qué hay que hacer */}
          <Paso n={4} titulo="¿Qué hay que hacer?">
            <Textarea
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              rows={3}
              placeholder={enfoque === "comercial" ? "Ej: posteo con la foto del combo, que se vea el precio grande y que inviten a pedir por WhatsApp" : "Ej: avisar que el sábado abrimos hasta las 2 AM"}
              className="resize-none"
            />
            <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Texto que va en la pieza, tal cual (opcional)" className="mt-2" />
            <button type="button" onClick={() => setMas((v) => !v)} className="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", mas && "rotate-180")} /> Más datos (producto, oferta, para cuándo)
            </button>
            {mas && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 animate-in fade-in slide-in-from-top-1">
                <Input value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Producto o servicio" />
                <Input value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="Precio o promo" />
                <Input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Llamado a la acción (ej: pedí por WhatsApp)" />
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Para cuándo" />
              </div>
            )}
          </Paso>
        </div>

        {/* Pie: cupo del plan y cargar */}
        <div className="space-y-3 border-t bg-muted/30 px-6 py-4">
          {cliente && cupo && (
            entra ? (
              <p className="flex items-center gap-2 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" />
                </span>
                Entra en el plan de {cliente.nombre}: le quedan <b>{cupo.quedan}</b> de {cupo.incluidas} este mes.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm">
                  A {cliente.nombre} {cupo.incluidas ? "ya no le quedan piezas del plan este mes" : "su plan no incluye piezas"}. ¿Cómo la cargamos?
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      { v: "sin_cargo", t: "Sin cargo", d: "La hacemos igual, no se cobra", i: Gift },
                      { v: "cobrar", t: "Que la pague el cliente", d: `${formatARS(precio)} · le avisamos para que la pague`, i: Receipt },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setFuera(o.v)}
                      className={cn(
                        "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all",
                        fuera === o.v ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-card hover:border-primary/50"
                      )}
                    >
                      <o.i className={cn("mt-0.5 h-4 w-4 shrink-0", fuera === o.v ? "text-primary" : "text-muted-foreground")} />
                      <span>
                        <span className="block text-sm font-semibold">{o.t}</span>
                        <span className="block text-xs text-muted-foreground">{o.d}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={() => void cargar()} disabled={!listo || enviando} className="min-w-40 bg-gradient-to-r from-[#6F40FC] to-[#E040A0] text-white hover:opacity-90">
              {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Cargar pieza
            </Button>
          </div>
          {!cliente && <p className="text-right text-[11px] text-muted-foreground">Elegí el cliente para seguir.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Paso({ n, titulo, ayuda, children }: { n: number; titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-start gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{n}</span>
        <div>
          <p className="text-sm font-semibold leading-6">{titulo}</p>
          {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
