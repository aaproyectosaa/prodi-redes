import { useEffect, useMemo, useRef, useState } from "react";
import { Facebook, Image as ImageIcon, Instagram, MessageCircle, Send, ShoppingBag, StickyNote, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  anotarContacto,
  canalesDe,
  escribirContacto,
  linkCanal,
  ORIGENES,
  sumarDiasCrm,
  type CanalCrm,
  type ContactoCrm,
  type EventoCrm,
  type VendedorCrm,
} from "@/lib/redes/crm";
import { cn } from "@/lib/utils";
import { GaleriaChat } from "@/components/redes/crm/GaleriaChat";
import { PanelFicha } from "@/components/redes/crm/PanelFicha";
import { ConfigCatalogo, SelectorProductos, type Producto } from "@/components/redes/crm/CatalogoProductos";
import { callApi } from "@/lib/redes/api";

// La ficha de un contacto, como la de Leads: a la izquierda la charla (lo que le escribió, lo que respondió y las
// notas) y a la derecha la etapa, quién lo atiende, la venta y sus datos. Se le escribe por WhatsApp, Instagram o
// Facebook: se abre el chat de esa red con el mensaje y queda guardado acá. Con "Fotos y videos" se le
// manda un link a un video o pieza de Prodi o a algo que subió el cliente.

const CANALES: Record<CanalCrm, { label: string; icono: React.ElementType; clase: string }> = {
  whatsapp: { label: "WhatsApp", icono: MessageCircle, clase: "text-emerald-600 dark:text-emerald-400" },
  instagram: { label: "Instagram", icono: Instagram, clase: "text-pink-600 dark:text-pink-400" },
  facebook: { label: "Facebook", icono: Facebook, clase: "text-sky-600 dark:text-sky-400" },
};

/** Respuestas guardadas: el {nombre} se cambia por el del contacto. */
const RAPIDAS = [
  { titulo: "Saludo", texto: "¡Hola {nombre}! Gracias por escribirnos. ¿En qué te podemos ayudar?" },
  { titulo: "Pasar precio", texto: "¡Hola {nombre}! Te paso el precio: " },
  { titulo: "Seguimiento", texto: "¡Hola {nombre}! ¿Pudiste ver lo que te pasé? Cualquier duda, avisame." },
  { titulo: "Cerrar", texto: "¡Buenísimo {nombre}! Te lo reservo. ¿Cómo preferís pagar?" },
];

const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
const dia = (iso: string) => {
  const f = new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  if (f === hoyAR()) return "Hoy";
  if (f === sumarDiasCrm(hoyAR(), -1)) return "Ayer";
  return new Date(iso).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "short" });
};
const hace = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
};
const iniciales = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

function Herramienta({ activo, onClick, titulo, className, children }: { activo: boolean; onClick: () => void; titulo: string; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        activo ? "border-primary bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

/** La charla: lo que pidió al llegar, los mensajes de ida y vuelta y las notas. */
function Charla({ c, vendedor }: { c: ContactoCrm; vendedor?: VendedorCrm }) {
  const canales = canalesDe(c);
  const porOrigen = (["whatsapp", "instagram", "facebook"] as CanalCrm[]).find((k) => k === c.origen && canales.includes(k));
  const [canal, setCanal] = useState<CanalCrm | null>(porOrigen ?? canales[0] ?? null);
  // Nota: queda acá y al contacto no le llega.
  const [nota, setNota] = useState(false);
  const [texto, setTexto] = useState("");
  const [panel, setPanel] = useState<"rapidas" | "galeria" | "productos" | "catalogo" | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (canal && !canales.includes(canal)) setCanal(canales[0] ?? null);
  }, [canal, canales]);

  // Lo que pidió al llegar va primero, como su mensaje; después todo lo que pasó.
  const eventos: EventoCrm[] = useMemo(
    () => [...(c.interes ? [{ at: c.creado_at, texto: c.interes, tipo: "suyo" as const }] : []), ...(c.historial ?? [])].sort((a, b) => a.at.localeCompare(b.at)),
    [c.interes, c.creado_at, c.historial]
  );
  useEffect(() => {
    caja.current?.scrollTo({ top: caja.current.scrollHeight });
  }, [eventos.length]);

  // Los productos elegidos quedan escritos en el mensaje (nombre, precio y su link con aviso).
  const elegirProductos = async (lista: Producto[]) => {
    try {
      const r = await callApi<{ productos: { nombre: string; precio_texto: string; link: string }[] }>("/api/publico/catalogo-links", {
        negocio: c.proyecto_id,
        ids: lista.map((p) => p.id),
        contacto: { col: "crm_contactos", id: c.id },
      });
      const t = r.productos.map((p) => `${p.nombre}${p.precio_texto ? ` — ${p.precio_texto}` : ""}${p.link ? `\n${p.link}` : ""}`).join("\n\n");
      setTexto((x) => (x.trim() ? `${x.trim()}\n\n${t}` : t));
      setNota(false);
      setPanel(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron preparar los links");
    }
  };

  const enviar = async () => {
    const t = texto.trim();
    if (!t) return;
    try {
      if (!nota) {
        if (!canal) return toast.error("Cargale un WhatsApp, Instagram o Facebook para escribirle");
        // En Instagram y Facebook no se puede dejar el texto escrito: se copia para pegarlo.
        if (canal !== "whatsapp") await navigator.clipboard?.writeText(t).catch(() => undefined);
        window.open(linkCanal(c, canal, t), "_blank", "noopener");
        await escribirContacto(c, t, canal);
        if (canal !== "whatsapp") toast.success(`Mensaje copiado: pegalo en ${CANALES[canal].label}`);
      } else {
        await anotarContacto(c, t, "nota");
      }
      setTexto("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    }
  };

  const Red = canal ? CANALES[canal].icono : MessageCircle;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* Barra fina: por dónde se le escribe. */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Red className={cn("h-4 w-4 shrink-0", canal ? CANALES[canal].clase : "text-muted-foreground")} />
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {canal ? (
            <>
              <span className="font-semibold text-foreground">{CANALES[canal].label}</span>
              {vendedor ? ` · lo atiende ${vendedor.nombre}` : ""}
            </>
          ) : (
            "Cargale un WhatsApp, Instagram o Facebook en la ficha para escribirle"
          )}
        </p>
        {canales.length > 1 && (
          <div className="flex gap-0.5 rounded-full bg-muted p-0.5">
            {canales.map((k) => {
              const I = CANALES[k].icono;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCanal(k)}
                  title={CANALES[k].label}
                  aria-label={CANALES[k].label}
                  className={cn("flex h-7 w-7 items-center justify-center rounded-full transition-colors", canal === k ? cn("bg-background shadow-sm", CANALES[k].clase) : "text-muted-foreground hover:text-foreground")}
                >
                  <I className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Mensajes */}
      <div
        ref={caja}
        className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] bg-[length:20px_20px] px-4 py-4 sm:px-6"
      >
        {eventos.map((e, i) => {
          const nuevoDia = i === 0 || dia(eventos[i - 1].at) !== dia(e.at);
          return (
            <div key={`${e.at}-${i}`}>
              {nuevoDia && (
                <div className="my-4 flex items-center gap-3 first:mt-0">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{dia(e.at)}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              {e.tipo === "mio" || e.tipo === "suyo" ? (
                <div className={cn("mt-2 flex", e.tipo === "mio" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug",
                      e.tipo === "mio" ? "rounded-br-sm bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/20" : "rounded-bl-sm border bg-card shadow-sm"
                    )}
                  >
                    <span className="whitespace-pre-wrap break-words">{e.texto}</span>
                    <span className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10px]", e.tipo === "mio" ? "text-white/75" : "text-muted-foreground")}>
                      {e.canal ? CANALES[e.canal].label : ""}
                      {e.canal ? " · " : ""}
                      {hora(e.at)}
                    </span>
                  </div>
                </div>
              ) : e.tipo === "nota" || e.tipo === "llamada" || e.tipo === "visita" || e.tipo === "email" ? (
                <div className="mt-2 flex justify-center">
                  <p className="flex max-w-[85%] items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">
                    <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="whitespace-pre-wrap break-words">{e.texto}</span>
                    <span className="shrink-0 text-[10px] opacity-70">{hora(e.at)}</span>
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  {e.texto} · {hora(e.at)}
                </p>
              )}
            </div>
          );
        })}
        {eventos.length === 0 && <p className="py-16 text-center text-xs text-muted-foreground">Todavía no hay nada. Escribile para arrancar.</p>}
      </div>

      {/* Productos del catálogo: cada uno va con un link que avisa acá cuando lo abre. */}
      {panel === "productos" && (
        <div className="border-t bg-muted/40 p-2">
          <SelectorProductos negocio={c.proyecto_id} onElegir={(l) => elegirProductos(l)} onCerrar={() => setPanel(null)} onConfigurar={() => setPanel("catalogo")} />
        </div>
      )}
      {panel === "catalogo" && (
        <div className="max-h-[50vh] overflow-y-auto border-t bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tu catálogo</p>
            <button type="button" onClick={() => setPanel("productos")} className="text-[11px] font-semibold text-primary hover:underline">
              Volver a elegir
            </button>
          </div>
          <ConfigCatalogo negocio={c.proyecto_id} />
        </div>
      )}

      {/* Respuestas rápidas */}
      {panel === "galeria" && (
        <GaleriaChat
          proyectoId={c.proyecto_id}
          onCerrar={() => setPanel(null)}
          onElegir={(t) => {
            setTexto((x) => (x.trim() ? `${x.trim()}\n${t}` : t));
            setNota(false);
            setPanel(null);
          }}
        />
      )}
      {panel === "rapidas" && (
        <div className="border-t bg-muted/40 p-2">
          <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Respuestas rápidas</p>
          <div className="grid max-h-44 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {RAPIDAS.map((r) => {
              const t = r.texto.replace("{nombre}", c.nombre.split(" ")[0]);
              return (
                <button
                  key={r.titulo}
                  type="button"
                  onClick={() => {
                    setTexto(t);
                    setNota(false);
                    setPanel(null);
                  }}
                  className="rounded-xl border bg-card p-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  <span className="block text-xs font-semibold">{r.titulo}</span>
                  <span className="line-clamp-2 block text-[11px] text-muted-foreground">{t}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Escribir */}
      <div className="border-t bg-background px-3 pb-3 pt-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Herramienta activo={panel === "galeria"} onClick={() => setPanel(panel === "galeria" ? null : "galeria")} titulo="Mandale fotos o videos: los que hizo Prodi o los tuyos">
            <ImageIcon className="h-3.5 w-3.5" /> Fotos y videos
          </Herramienta>
          <Herramienta activo={panel === "productos" || panel === "catalogo"} onClick={() => setPanel(panel === "productos" ? null : "productos")} titulo="Mandale productos de tu catálogo (con link que avisa cuando lo abre)">
            <ShoppingBag className="h-3.5 w-3.5" /> Productos
          </Herramienta>
          <Herramienta activo={panel === "rapidas"} onClick={() => setPanel(panel === "rapidas" ? null : "rapidas")} titulo="Respuestas guardadas">
            <Zap className="h-3.5 w-3.5" /> Rápidas
          </Herramienta>
          <Herramienta activo={nota} onClick={() => setNota(!nota)} titulo="Anotar algo interno: al contacto no le llega" className="ml-auto">
            <StickyNote className="h-3.5 w-3.5" /> Nota
          </Herramienta>
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={1}
            placeholder={nota ? "Anotá algo (al contacto no le llega)…" : canal ? `Escribirle por ${CANALES[canal].label}…` : "Cargale un WhatsApp, Instagram o Facebook para escribirle"}
            className={cn("max-h-[140px] min-h-[42px] resize-none rounded-2xl text-sm", nota ? "border-amber-500/50 bg-amber-500/10" : "bg-muted/50")}
            maxLength={2000}
          />
          <Button
            size="icon"
            className={cn("h-[42px] w-[42px] shrink-0 rounded-full shadow-md", nota ? "bg-amber-500 hover:bg-amber-500/90" : "bg-gradient-to-br from-primary to-fuchsia-500 shadow-primary/25")}
            onClick={() => void enviar()}
            disabled={!texto.trim() || (!nota && !canal)}
            aria-label={nota ? "Guardar nota" : "Enviar"}
          >
            {nota ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function FichaContacto({ c, vendedores, onCerrar }: { c: ContactoCrm | null; vendedores: VendedorCrm[]; onCerrar: () => void }) {
  const [pestana, setPestana] = useState<"chat" | "ficha">("chat");
  useEffect(() => setPestana("chat"), [c?.id]);
  if (!c) return null;
  const o = ORIGENES.find((x) => x.k === c.origen) ?? ORIGENES[ORIGENES.length - 1];
  const vendedor = vendedores.find((v) => v.id === c.vendedor_id);

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="flex h-[min(860px,92dvh)] max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-3xl bg-background p-0">
        {/* Encabezado */}
        <DialogHeader className="shrink-0 flex-row items-center gap-3 space-y-0 border-b bg-gradient-to-r from-primary/[0.08] via-fuchsia-500/[0.05] to-transparent px-5 py-3.5 pr-12 text-left">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 text-sm font-bold text-white shadow-md shadow-primary/25">
            {iniciales(c.nombre)}
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-lg">{c.nombre}</DialogTitle>
            <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", o.clase)}>
                <o.icono className="h-3 w-3" /> {o.label}
              </span>
              <span>· llegó {hace(c.creado_at)}</span>
              {vendedor && <span>· lo atiende {vendedor.nombre}</span>}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* En el celular: una cosa por vez (chat o ficha). En la compu, lado a lado. */}
          <div className="grid shrink-0 grid-cols-2 gap-1 border-b p-1.5 md:hidden">
            {(["chat", "ficha"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPestana(p)}
                className={cn("rounded-lg py-2 text-sm font-semibold transition-colors", pestana === p ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground")}
              >
                {p === "chat" ? "Chat" : "Ficha"}
              </button>
            ))}
          </div>
          <div className={cn("min-h-0 flex-1 md:flex md:flex-col md:border-r", pestana === "chat" ? "flex flex-col" : "hidden")}>
            <Charla c={c} vendedor={vendedor} />
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto bg-background p-4 md:block", pestana === "ficha" ? "block" : "hidden")}>
            <PanelFicha c={c} vendedores={vendedores} onCerrar={onCerrar} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
