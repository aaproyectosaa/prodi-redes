import { useMemo, useState } from "react";
import { BellRing, ChevronDown, Facebook, Instagram, MessageCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Project } from "@/integrations/firebase/types";
import {
  canalesDe,
  linkCanal,
  crearContacto,
  ETAPAS,
  moverContacto,
  ORIGENES,
  resumenCrm,
  useContactos,
  useVendedores,
  vendedorSugerido,
  videosParaElegir,
  type ContactoCrm,
  type EtapaCrm,
  type OrigenCrm,
  type VendedorCrm,
} from "@/lib/redes/crm";
import { iniciales } from "@/components/redes/crm/EquipoCrm";
import { FichaContacto } from "@/components/redes/crm/FichaContacto";
import { dinero, fechasDeMes, resumirPauta, usePautaMeta } from "@/lib/redes/metaPauta";
import { cn } from "@/lib/utils";
import { useRedes } from "@/contexts/redes-data-context";

// "Mis contactos": el CRM del cliente (beta). Tablero por etapas, a quién escribirle hoy y, con las ventas y la pauta
// de Meta, cuánto le costó cada venta.

const plata = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
const mesActual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 7);
const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const cuando = (f: string) => {
  const d = Math.round((new Date(`${f}T12:00:00`).getTime() - new Date(`${hoyAR()}T12:00:00`).getTime()) / 86_400_000);
  return d < 0 ? `hace ${-d} día${d === -1 ? "" : "s"}` : d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`;
};
const origen = (k: OrigenCrm) => ORIGENES.find((o) => o.k === k) ?? ORIGENES[ORIGENES.length - 1];

const hace = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} d`;
};

function Tarjeta({ c, vendedor, onAbrir }: { c: ContactoCrm; vendedor?: VendedorCrm; onAbrir: () => void }) {
  const o = origen(c.origen);
  const atrasado = c.proximo && c.proximo <= hoyAR() && c.etapa !== "vendido" && c.etapa !== "perdido";
  return (
    <div className="group rounded-xl border bg-card p-3 text-sm shadow-sm transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-md">
      <button type="button" onClick={onAbrir} className="block w-full min-w-0 text-left">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", o.clase)}>
            <o.icono className="h-3 w-3" /> {o.label}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{hace(c.creado_at)}</span>
        </span>
        <span className="mt-2 block truncate text-[15px] font-semibold leading-tight">{c.nombre}</span>
        {c.interes && <span className="mt-1.5 line-clamp-2 block text-xs leading-snug text-foreground/80">“{c.interes}”</span>}
        {(atrasado || (c.etapa === "vendido" && !!c.monto_venta)) && (
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {c.etapa === "vendido" && !!c.monto_venta && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{plata(c.monto_venta)}</span>
            )}
            {atrasado && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                <BellRing className="h-3 w-3" /> Escribile {cuando(c.proximo!)}
              </span>
            )}
          </span>
        )}
      </button>
      <div className="mt-2 flex items-center gap-1 border-t pt-2">
        {canalesDe(c).map((k) => {
          const I = k === "whatsapp" ? MessageCircle : k === "instagram" ? Instagram : Facebook;
          return (
            <a
              key={k}
              href={linkCanal(c, k, k === "whatsapp" ? `¡Hola ${c.nombre.split(" ")[0]}! ` : "")}
              target="_blank"
              rel="noreferrer"
              title={k === "whatsapp" ? `WhatsApp ${c.telefono}` : k === "instagram" ? "Abrir chat de Instagram" : "Abrir chat de Facebook"}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                k === "whatsapp" ? "text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400" : k === "instagram" ? "text-pink-600 hover:bg-pink-500/10 dark:text-pink-400" : "text-sky-600 hover:bg-sky-500/10 dark:text-sky-400"
              )}
            >
              <I className="h-3.5 w-3.5" />
            </a>
          );
        })}
        {vendedor && (
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" title={`Lo atiende ${vendedor.nombre}`}>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary">{iniciales(vendedor.nombre)}</span>
            <span className="truncate">{vendedor.nombre.split(" ")[0]}</span>
          </span>
        )}
        {/* Mover de etapa (en la compu también se arrastra la tarjeta). */}
        <label className="relative ml-auto flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          Mover
          <ChevronDown className="h-3 w-3" />
          <select
            value={c.etapa}
            onChange={(e) => {
              const etapa = e.target.value as EtapaCrm;
              if (etapa === "vendido") onAbrir();
              else void moverContacto(c, etapa);
            }}
            aria-label="Mover a"
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {ETAPAS.map((e) => (
              <option key={e.k} value={e.k}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function ElegirVendedor({ vendedores, valor, onElegir }: { vendedores: VendedorCrm[]; valor: string | null; onElegir: (id: string | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {[{ id: null as string | null, nombre: "Nadie" }, ...vendedores.filter((v) => v.activo || v.id === valor)].map((v) => (
        <button
          key={v.id ?? "nadie"}
          type="button"
          onClick={() => onElegir(v.id)}
          className={cn("rounded-full border px-3 py-1 text-xs", valor === v.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
        >
          {v.nombre}
        </button>
      ))}
    </div>
  );
}

function NuevoContacto({ proyectoId, vendedores, sugerido, onListo }: { proyectoId: string; vendedores: VendedorCrm[]; sugerido: string | null; onListo: () => void }) {
  const [vendedor, setVendedor] = useState<string | null>(sugerido);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [usuario, setUsuario] = useState("");
  const [orig, setOrig] = useState<OrigenCrm>("whatsapp");
  const [video, setVideo] = useState<string | null>(null);
  const { videos } = useRedes();
  const paraElegir = videosParaElegir(videos, proyectoId);
  const [interes, setInteres] = useState("");
  const [busy, setBusy] = useState(false);
  const guardar = async () => {
    if (!nombre.trim()) return toast.error("Poné al menos el nombre");
    setBusy(true);
    try {
      await crearContacto(proyectoId, { nombre: nombre.trim(), telefono: telefono.trim() || null, email: null, origen: orig, interes: interes.trim() || null, notas: null, vendedor_id: vendedor,
        ...(orig === "anuncio" && video ? { video_id: video } : {}),
        ...(orig === "instagram" && usuario.trim() ? { instagram: usuario.trim().replace(/^@/, "") } : {}),
        ...(orig === "facebook" && usuario.trim() ? { facebook: usuario.trim() } : {}),
      });
      toast.success("Contacto cargado");
      onListo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Nombre</Label>
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Marta" autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label>WhatsApp</Label>
        <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej.: 3492 123456" inputMode="tel" />
      </div>
      <div className="space-y-1.5">
        <Label>¿De dónde vino?</Label>
        <div className="flex flex-wrap gap-1.5">
          {ORIGENES.map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => setOrig(o.k)}
              className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", orig === o.k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              <o.icono className="h-3.5 w-3.5" /> {o.label}
            </button>
          ))}
        </div>
      </div>
      {orig === "anuncio" && paraElegir.length > 0 && (
        <div className="space-y-1.5">
          <Label>¿Qué video lo trajo?</Label>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {[{ id: null as string | null, titulo: "No sé" }, ...paraElegir].map((v) => (
              <button
                key={v.id ?? "nose"}
                type="button"
                onClick={() => setVideo(v.id)}
                className={cn("rounded-full border px-3 py-1 text-xs", video === v.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {v.titulo}
              </button>
            ))}
          </div>
        </div>
      )}
      {(orig === "instagram" || orig === "facebook") && (
        <div className="space-y-1.5">
          <Label>{orig === "instagram" ? "Usuario de Instagram" : "Usuario de Facebook"}</Label>
          <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder={orig === "instagram" ? "@usuario" : "usuario o link del perfil"} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>¿Qué quiere?</Label>
        <Textarea value={interes} onChange={(e) => setInteres(e.target.value)} rows={2} placeholder="Ej.: 2 pizzas para el sábado, pregunta por delivery" />
      </div>
      {vendedores.length > 0 && (
        <div className="space-y-1.5">
          <Label>Lo atiende</Label>
          <ElegirVendedor vendedores={vendedores} valor={vendedor} onElegir={setVendedor} />
        </div>
      )}
      <Button className="w-full" onClick={() => void guardar()} disabled={busy}>
        Guardar contacto
      </Button>
    </div>
  );
}

export function Contactos({ cliente, nuevo, onNuevo }: { cliente: Project; nuevo: boolean; onNuevo: (v: boolean) => void }) {
  const todos = useContactos(cliente.id);
  const vendedores = useVendedores(cliente.id) ?? [];
  const [filtro, setFiltro] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<EtapaCrm | null>(null);
  const mes = mesActual();
  const q = busca.trim().toLowerCase();
  const lista = (todos ?? []).filter(
    (c) =>
      (filtro === "todos" || (filtro === "sin" ? !c.vendedor_id : c.vendedor_id === filtro)) &&
      (!q || `${c.nombre} ${c.telefono ?? ""} ${c.interes ?? ""}`.toLowerCase().includes(q))
  );
  const r = useMemo(() => resumenCrm(todos ?? [], mes), [todos, mes]);
  // Lo invertido en Meta este mes (si su cuenta está conectada) para el costo de cada venta.
  const f = fechasDeMes(mes);
  const pauta = usePautaMeta(cliente.meta?.ad_account_id ? cliente.id : undefined, f.desde);
  const inversion = pauta ? resumirPauta(pauta, f.desde, f.hasta) : null;
  const costo = inversion && inversion.gasto > 0 && r.vendidos ? dinero(inversion.gasto / r.vendidos, inversion.moneda) : null;
  const elegido = (todos ?? []).find((c) => c.id === abierto) ?? null;

  const soltar = async (etapa: EtapaCrm, id: string) => {
    setArrastrando(null);
    setSobre(null);
    const c = (todos ?? []).find((x) => x.id === id);
    if (!c || c.etapa === etapa) return;
    if (etapa === "vendido") return setAbierto(c.id);
    await moverContacto(c, etapa).catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo"));
  };

  return (
    <div>
      {/* Resumen: cuántos hay en cada etapa y lo que se vendió en el mes. */}
      <div className="mb-3 flex flex-wrap items-stretch gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-2xl border bg-card p-1.5">
          {ETAPAS.map((e, i) => {
            const n = (todos ?? []).filter((c) => c.etapa === e.k).length;
            return (
              <div key={e.k} className="flex min-w-[88px] flex-1 items-center gap-2 rounded-xl px-3 py-2">
                {i > 0 && <span className="-ml-3 mr-1 text-muted-foreground/40">›</span>}
                <span className={cn("h-2 w-2 shrink-0 rounded-full", e.punto)} />
                <span className="min-w-0">
                  <span className={cn("block text-xl font-bold leading-none tabular-nums", n ? e.texto : "text-muted-foreground/50")}>{n}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{e.label}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex min-w-[240px] items-center gap-4 rounded-2xl border bg-card px-4 py-2">
          <span>
            <span className="block text-[11px] text-muted-foreground">Vendiste este mes</span>
            <b className="text-lg tabular-nums text-emerald-600 dark:text-emerald-400">{plata(r.total)}</b>
          </span>
          <span className="border-l pl-4" title={inversion && inversion.gasto > 0 ? `Invertiste ${dinero(inversion.gasto, inversion.moneda)} en publicidad` : "Se calcula con tu publicidad de Meta"}>
            <span className="block text-[11px] text-muted-foreground">Cada venta te costó</span>
            <b className="text-lg tabular-nums">{costo ?? "—"}</b>
          </span>
        </div>
      </div>

      {/* A quién escribirle hoy. */}
      {r.paraHoy.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <BellRing className="h-3.5 w-3.5" /> Hoy escribiles a
          </span>
          {r.paraHoy.slice(0, 10).map((c) => (
            <button key={c.id} type="button" onClick={() => setAbierto(c.id)} className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium hover:border-primary">
              {c.nombre}
            </button>
          ))}
        </div>
      )}

      {/* Buscar y filtrar por quién lo atiende. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nombre, teléfono o pedido" className="h-9 rounded-full pl-9" />
        </div>
        {vendedores.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[{ id: "todos", nombre: "Todos" }, ...vendedores, { id: "sin", nombre: "Sin asignar" }].map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setFiltro(v.id)}
                className={cn(
                  "flex h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                  filtro === v.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                {v.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* El tablero. */}
      <div className="-mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:snap-none md:px-8">
        <div className="flex min-w-max gap-3 xl:grid xl:min-w-0 xl:grid-cols-5">
          {ETAPAS.map((e) => {
            const items = lista.filter((c) => c.etapa === e.k);
            return (
              <div
                key={e.k}
                className={cn(
                  "flex w-[82vw] shrink-0 snap-start flex-col rounded-2xl border border-t-4 bg-muted/40 transition-colors sm:w-72 xl:w-auto",
                  e.color,
                  arrastrando && sobre === e.k && "border-primary bg-primary/10 ring-2 ring-primary/30"
                )}
                onDragOver={(ev) => {
                  if (!arrastrando) return;
                  ev.preventDefault();
                  if (sobre !== e.k) setSobre(e.k);
                }}
                onDragLeave={(ev) => !ev.currentTarget.contains(ev.relatedTarget as Node) && setSobre(null)}
                onDrop={(ev) => {
                  ev.preventDefault();
                  const id = ev.dataTransfer.getData("text/contacto-id") || arrastrando;
                  if (id) void soltar(e.k, id);
                }}
              >
                <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-2.5" title={e.ayuda}>
                  <p className="text-sm font-semibold">{e.label}</p>
                  <span className={cn("rounded-full bg-background px-2 py-0.5 text-xs font-bold tabular-nums shadow-sm", items.length ? e.texto : "text-muted-foreground")}>{items.length}</span>
                </div>
                <div className="flex min-h-[140px] flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-300px)] md:overflow-y-auto">
                  {items.map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData("text/contacto-id", c.id);
                        ev.dataTransfer.effectAllowed = "move";
                        setArrastrando(c.id);
                      }}
                      onDragEnd={() => {
                        setArrastrando(null);
                        setSobre(null);
                      }}
                      className={cn("min-w-0 cursor-grab active:cursor-grabbing", arrastrando === c.id && "opacity-40")}
                    >
                      <Tarjeta c={c} vendedor={vendedores.find((v) => v.id === c.vendedor_id)} onAbrir={() => setAbierto(c.id)} />
                    </div>
                  ))}
                  {items.length === 0 && (
                    <p className={cn("m-1 rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground/70", arrastrando && "border-primary/50 text-primary")}>
                      {arrastrando ? "Soltalo acá" : busca || filtro !== "todos" ? "Nada con ese filtro" : e.ayuda}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={nuevo} onOpenChange={onNuevo}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo contacto</DialogTitle>
            <DialogDescription>Alguien que te escribió o te consultó. Después lo vas moviendo hasta que compre.</DialogDescription>
          </DialogHeader>
          <NuevoContacto proyectoId={cliente.id} vendedores={vendedores} sugerido={vendedorSugerido(vendedores, todos ?? [])} onListo={() => onNuevo(false)} />
        </DialogContent>
      </Dialog>

      <FichaContacto c={elegido} vendedores={vendedores} onCerrar={() => setAbierto(null)} />
    </div>
  );
}
