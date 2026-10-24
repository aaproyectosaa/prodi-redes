import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Eye,
  Image as ImageIcon,
  Megaphone,
  MessageCircle,
  MousePointer2,
  Package,
  Phone,
  Pizza,
  Send,
  ShoppingBag,
  StickyNote,
  Wrench,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Demo de "Mis contactos" para el CRM en Próximamente: como un video, con las pantallas reales y un cursor que va
// tocando. Entra un mensaje, se abre la ficha con el chat, se manda un producto del catálogo de la web por WhatsApp,
// el cliente lo abre y responde, y se anota la venta. Los datos son de ejemplo y se adaptan al rubro del negocio.

const ANCHO = 1000;
const ALTO = 560;

interface Producto {
  nombre: string;
  precio: string;
  color: string;
}
interface Tema {
  icono: React.ElementType;
  contacto: string;
  ini: string;
  pregunta: string;
  respuesta: string;
  productos: Producto[];
  venta: string;
  video: string;
  otros: { nombre: string; texto: string; col: number }[];
}

const TEMAS: Record<"gastronomia" | "servicios" | "comercio", Tema> = {
  gastronomia: {
    icono: Pizza,
    contacto: "Marta Gómez",
    ini: "MG",
    pregunta: "¡Hola! ¿Hacen delivery a barrio Norte? Quiero 2 grandes para el sábado",
    respuesta: "¡Dale! Lo quiero para el sábado a las 21 hs",
    productos: [
      { nombre: "Promo 2 grandes", precio: "$ 24.000", color: "from-orange-400 to-red-500" },
      { nombre: "Muzzarella grande", precio: "$ 11.500", color: "from-amber-300 to-orange-500" },
      { nombre: "Napolitana", precio: "$ 13.200", color: "from-red-400 to-rose-600" },
      { nombre: "Fainá", precio: "$ 3.500", color: "from-yellow-300 to-amber-500" },
    ],
    venta: "$ 24.000",
    video: "Promo 2x1 de los jueves",
    otros: [
      { nombre: "Julián Pérez", texto: "Pregunta por la promo familiar", col: 0 },
      { nombre: "Sofía Ramírez", texto: "¿Tienen opciones sin TACC?", col: 1 },
      { nombre: "Club Atlético Sur", texto: "30 pizzas para el cumple del 14", col: 2 },
      { nombre: "Ana Torres", texto: "Promo 2x1 del martes", col: 3 },
    ],
  },
  servicios: {
    icono: Wrench,
    contacto: "Marcos Díaz",
    ini: "MD",
    pregunta: "Hola, ¿cuánto sale la instalación para un local de 120 m²? Necesito presupuesto",
    respuesta: "Perfecto, ¿pueden venir el martes a medir?",
    productos: [
      { nombre: "Instalación eléctrica", precio: "Desde $ 850.000", color: "from-sky-400 to-blue-600" },
      { nombre: "Mantenimiento mensual", precio: "$ 120.000", color: "from-emerald-400 to-teal-600" },
      { nombre: "Tablero industrial", precio: "$ 1.250.000", color: "from-violet-400 to-indigo-600" },
      { nombre: "Relevamiento", precio: "$ 60.000", color: "from-amber-300 to-orange-500" },
    ],
    venta: "$ 850.000",
    video: "Así dejamos un local en 3 días",
    otros: [
      { nombre: "Laura Benítez", texto: "Consulta por mantenimiento", col: 0 },
      { nombre: "Estudio Ríos", texto: "Pide visita técnica", col: 1 },
      { nombre: "Fábrica Norte", texto: "Presupuesto de tablero", col: 2 },
      { nombre: "Comercio Centro", texto: "Instalación completa", col: 3 },
    ],
  },
  comercio: {
    icono: ShoppingBag,
    contacto: "Lucía Fernández",
    ini: "LF",
    pregunta: "Hola, ¿tienen stock del pack x100? ¿Hacen envíos al interior?",
    respuesta: "¡Genial! Me llevo 3 packs, ¿cómo te pago?",
    productos: [
      { nombre: "Pack x100 unidades", precio: "$ 12.500", color: "from-violet-400 to-fuchsia-600" },
      { nombre: "Pack mayorista x500", precio: "$ 54.000", color: "from-sky-400 to-indigo-600" },
      { nombre: "Combo emprendedor", precio: "$ 28.900", color: "from-emerald-400 to-teal-600" },
      { nombre: "Edición especial", precio: "$ 9.800", color: "from-amber-300 to-orange-500" },
    ],
    venta: "$ 37.500",
    video: "Lo más vendido del mes",
    otros: [
      { nombre: "Julián Pérez", texto: "Pregunta precio mayorista", col: 0 },
      { nombre: "Sofía Ramírez", texto: "¿Hacen factura A?", col: 1 },
      { nombre: "Distribuidora Sur", texto: "Pedido de 20 packs", col: 2 },
      { nombre: "Ana Torres", texto: "Combo emprendedor", col: 3 },
    ],
  },
};

/** El tema de la demo según el rubro del negocio. */
export function temaDe(rubro: string | undefined | null): keyof typeof TEMAS {
  const r = String(rubro ?? "").toLowerCase();
  if (/gastron|pizz|resto|comida|bar|caf|panad|helad|burger|cocina|parrill|sushi/.test(r)) return "gastronomia";
  if (/servic|ingenier|instala|constru|obra|electric|consult|estudio|taller|mantenim|t[eé]cnic/.test(r)) return "servicios";
  return "comercio";
}

const PASOS = [
  "Te escribe un cliente por WhatsApp y entra solo a tu tablero",
  "Abrís su ficha: la charla, sus datos y qué hacer después",
  "Tocás «Productos»: tu catálogo de la web, con fotos y precios",
  "Elegís lo que le querés mandar",
  "Se lo mandás por WhatsApp con un toque",
  "Te avisa cuando abre el link… y cuando te responde",
  "Anotás la venta: sabés cuánto vendiste y qué video te lo trajo",
];
const DURACION = [3200, 3200, 3000, 2800, 3000, 3600, 4200];
/** Dónde está el cursor en cada paso (en el lienzo de 1000×560). */
const CURSOR: [number, number][] = [
  [760, 470],
  [140, 175],
  [128, 487],
  [270, 360],
  [500, 432],
  [760, 330],
  [855, 168],
];
const COLUMNAS = [
  { label: "Nuevos", raya: "border-t-sky-500", n: [2, 1, 1, 1, 1, 1, 1] },
  { label: "Les escribí", raya: "border-t-violet-500", n: [1, 1, 1, 1, 1, 1, 1] },
  { label: "Presupuesto", raya: "border-t-orange-500", n: [1, 1, 1, 1, 1, 1, 1] },
  { label: "Vendido", raya: "border-t-emerald-500", n: [1, 1, 1, 1, 1, 1, 2] },
];

function FotoProducto({ p, Icono, className }: { p: Producto; Icono: React.ElementType; className?: string }) {
  return (
    <span className={cn("relative flex items-center justify-center overflow-hidden bg-gradient-to-br text-white", p.color, className)}>
      <Icono className="h-1/2 w-1/2 opacity-90 drop-shadow" />
      <span className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/25 to-transparent" />
    </span>
  );
}

function TarjetaTablero({ nombre, texto, destacada }: { nombre: string; texto: string; destacada?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-2.5 shadow-sm", destacada && "border-primary/70 shadow-lg shadow-primary/20 ring-2 ring-primary/40")}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
          <MessageCircle className="h-3 w-3" /> WhatsApp
        </span>
        <span className="text-[10px] text-muted-foreground">{destacada ? "recién" : "ayer"}</span>
      </div>
      <p className="mt-1.5 truncate text-[13px] font-semibold">{nombre}</p>
      <p className="line-clamp-2 text-[11px] text-foreground/75">“{texto}”</p>
      {destacada && (
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
          <BellRing className="h-3 w-3" /> Escribile hoy
        </span>
      )}
      <div className="mt-2 flex items-center gap-1.5 border-t pt-1.5 text-[10px] text-muted-foreground">
        <MessageCircle className="h-3 w-3 text-emerald-500" />
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[8px] font-bold text-primary">CM</span> Caro
        <span className="ml-auto flex items-center gap-0.5">
          Mover <ChevronDown className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}

export function DemoContactos({ rubro }: { rubro?: string | null }) {
  const t = TEMAS[temaDe(rubro)];
  const [paso, setPaso] = useState(0);
  const [clic, setClic] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  // El lienzo se dibuja a 1000×560 y se achica para que entre (como un video).
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setEscala(Math.min(1.3, e.contentRect.width / ANCHO)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Un "clic" del cursor un poco antes de pasar al siguiente paso.
    const c1 = setTimeout(() => setClic(true), DURACION[paso] - 650);
    const c2 = setTimeout(() => setClic(false), DURACION[paso] - 350);
    const sig = setTimeout(() => setPaso((p) => (p + 1) % PASOS.length), DURACION[paso]);
    return () => [c1, c2, sig].forEach(clearTimeout);
  }, [paso]);

  const ficha = paso >= 1;
  const [cx, cy] = CURSOR[paso];
  const elegidos = paso >= 3 ? [0, 1] : [];
  const enviado = paso >= 4;
  const etapa = paso >= 6 ? 3 : paso >= 4 ? 1 : 0;
  const Icono = t.icono;

  return (
    <div className="space-y-3">
      <div ref={caja} className="relative w-full overflow-hidden rounded-2xl border bg-background shadow-xl" style={{ height: ALTO * escala }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: ANCHO, height: ALTO, transform: `scale(${escala})` }}>
          {/* ---- El tablero ---- */}
          <div className="absolute inset-0 space-y-3 bg-background p-5">
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-4 rounded-2xl border bg-card px-4 py-2">
                {["Nuevos", "Les escribí", "Presupuesto", "Vendido"].map((e, i) => (
                  <span key={e} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className={cn("h-2 w-2 rounded-full", ["bg-sky-500", "bg-violet-500", "bg-orange-500", "bg-emerald-500"][i])} />
                    <b className="text-base text-foreground">{COLUMNAS[i].n[paso]}</b> {e}
                  </span>
                ))}
              </div>
              <div className="rounded-2xl border bg-card px-4 py-2">
                <p className="text-[10px] text-muted-foreground">Vendiste este mes</p>
                <p className={cn("text-base font-bold tabular-nums", paso === 6 && "text-emerald-600 dark:text-emerald-400")}>{paso === 6 ? "+ " + t.venta : "$ 256.700"}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {COLUMNAS.map((c, i) => (
                <div key={c.label} className={cn("h-[400px] space-y-2 rounded-2xl border border-t-4 bg-muted/40 p-2", c.raya)}>
                  <p className="flex items-center justify-between px-1 text-xs font-semibold">
                    {c.label} <span className="rounded-full bg-background px-1.5 text-[10px] shadow-sm">{c.n[paso]}</span>
                  </p>
                  {i === etapa && <TarjetaTablero nombre={t.contacto} texto={t.pregunta} destacada={paso === 0} />}
                  {t.otros
                    .filter((o) => o.col === i)
                    .map((o) => (
                      <TarjetaTablero key={o.nombre} nombre={o.nombre} texto={o.texto} />
                    ))}
                </div>
              ))}
            </div>
            {/* Aviso de mensaje nuevo */}
            {paso === 0 && (
              <div className="absolute bottom-8 right-6 flex w-72 items-start gap-2.5 rounded-2xl border bg-card p-3 shadow-2xl animate-in fade-in slide-in-from-right-6 duration-500">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
                  <MessageCircle className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">Nuevo mensaje de {t.contacto.split(" ")[0]}</span>
                  <span className="line-clamp-2 block text-[11px] text-muted-foreground">{t.pregunta}</span>
                </span>
              </div>
            )}
          </div>

          {/* ---- La ficha con el chat ---- */}
          {ficha && (
            <div className="absolute inset-0 bg-black/40 p-5 animate-in fade-in duration-300">
              <div className="flex h-full flex-col overflow-hidden rounded-3xl border bg-background shadow-2xl animate-in zoom-in-95 duration-300">
                <div className="flex items-center gap-3 border-b bg-gradient-to-r from-primary/[0.1] via-fuchsia-500/[0.06] to-transparent px-5 py-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 text-sm font-bold text-white">{t.ini}</span>
                  <div>
                    <p className="text-base font-bold">{t.contacto}</p>
                    <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/12 px-2 py-0.5 font-semibold text-blue-700 dark:text-blue-300">
                        <Megaphone className="h-3 w-3" /> Anuncio de Meta
                      </span>
                      llegó recién · lo atiende Caro
                    </p>
                  </div>
                </div>
                <div className="grid min-h-0 flex-1 grid-cols-[1.3fr_1fr]">
                  {/* Chat */}
                  <div className="relative flex min-h-0 flex-col border-r">
                    <div className="flex items-center gap-2 border-b px-4 py-1.5 text-[11px]">
                      <MessageCircle className="h-3.5 w-3.5 text-emerald-600" /> <b>WhatsApp</b>
                      <span className="text-muted-foreground">· {t.contacto.split(" ")[0]} está esperando respuesta</span>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] bg-[length:20px_20px] px-5 py-3 [&>*]:shrink-0">
                      <p className="text-center text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Hoy</p>
                      <div className="max-w-[78%] rounded-2xl rounded-bl-sm border bg-card px-3 py-2 text-[12.5px] shadow-sm">
                        {t.pregunta}
                        <span className="mt-0.5 block text-right text-[9px] text-muted-foreground">20:41</span>
                      </div>
                      {enviado && (
                        <div className="ml-auto max-w-[80%] space-y-1.5 rounded-2xl rounded-br-sm bg-gradient-to-br from-primary to-fuchsia-500 p-2 text-[12px] text-white shadow-md animate-in fade-in slide-in-from-bottom-2 duration-500">
                          <p className="px-1">¡Hola {t.contacto.split(" ")[0]}! Te paso lo que buscás:</p>
                          {t.productos.slice(0, 2).map((p) => (
                            <div key={p.nombre} className="flex items-center gap-2 rounded-xl bg-white/15 p-1">
                              <FotoProducto p={p} Icono={Icono} className="h-8 w-8 shrink-0 rounded-lg" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-semibold">{p.nombre}</span>
                                <span className="block text-[11px] font-bold">{p.precio}</span>
                              </span>
                              <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-primary">Ver en la tienda</span>
                            </div>
                          ))}
                          <span className="flex items-center justify-end gap-1 px-1 text-[9px] text-white/80">
                            WhatsApp · 20:43 <Check className="h-3 w-3" />
                            <Check className="-ml-2 h-3 w-3" />
                          </span>
                        </div>
                      )}
                      {paso >= 5 && (
                        <>
                          <p className="mx-auto flex w-fit items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold text-sky-700 animate-in fade-in duration-500 dark:text-sky-300">
                            <Eye className="h-3 w-3" /> Abrió el link de {t.productos[0].nombre} · recién
                          </p>
                          <div className="max-w-[70%] rounded-2xl rounded-bl-sm border bg-card px-3 py-2 text-[12.5px] shadow-sm animate-in fade-in slide-in-from-left-2 duration-500 [animation-delay:900ms] [animation-fill-mode:backwards]">
                            {t.respuesta}
                            <span className="mt-0.5 block text-right text-[9px] text-muted-foreground">20:47</span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Catálogo de la web */}
                    {(paso === 2 || paso === 3) && (
                      <div className="absolute inset-x-0 bottom-[92px] border-t bg-muted/95 p-3 backdrop-blur animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="mb-2 flex items-center justify-between text-[11px]">
                          <span className="font-semibold">Tu catálogo · {t.productos.length} productos de tu web</span>
                          {paso === 3 && (
                            <span className="flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary animate-in fade-in duration-300">
                              2 elegidos <span className="rounded-full bg-primary px-2 py-0.5 text-primary-foreground">Mandar</span>
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {t.productos.map((p, i) => (
                            <div
                              key={p.nombre}
                              className={cn(
                                "relative overflow-hidden rounded-xl border bg-card transition-all duration-300",
                                elegidos.includes(i) ? "border-primary ring-2 ring-primary/40" : ""
                              )}
                              style={{ transitionDelay: `${i * 350}ms` }}
                            >
                              <FotoProducto p={p} Icono={Icono} className="h-14 w-full" />
                              {elegidos.includes(i) && (
                                <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow animate-in zoom-in duration-300" style={{ animationDelay: `${i * 350}ms` }}>
                                  <Check className="h-3 w-3" />
                                </span>
                              )}
                              <p className="truncate px-1.5 pt-1 text-[10px] font-medium">{p.nombre}</p>
                              <p className="px-1.5 pb-1.5 text-[11px] font-bold text-primary">{p.precio}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Barra para escribir */}
                    <div className="border-t px-3 pb-3 pt-2">
                      <div className="mb-1.5 flex gap-1.5 text-[11px]">
                        <span className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-muted-foreground">
                          <ImageIcon className="h-3 w-3" /> Fotos y videos
                        </span>
                        <span className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1", paso === 2 || paso === 3 ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>
                          <Package className="h-3 w-3" /> Productos
                        </span>
                        <span className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-muted-foreground">
                          <Zap className="h-3 w-3" /> Rápidas
                        </span>
                        <span className="ml-auto flex items-center gap-1 rounded-full border px-2.5 py-1 text-muted-foreground">
                          <StickyNote className="h-3 w-3" /> Nota
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 truncate rounded-2xl bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">
                          {paso === 3 ? `${t.productos[0].nombre} — ${t.productos[0].precio} · tutienda.com/…` : "Escribirle por WhatsApp…"}
                        </div>
                        <span className={cn("flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md", paso === 4 && "scale-110")}>
                          <Send className="h-4 w-4" />
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Ficha */}
                  <div className="space-y-3 overflow-hidden p-4">
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Etapa</p>
                      <div className="grid grid-cols-5 gap-1 rounded-xl bg-muted/70 p-1">
                        {["Nuevos", "Les escribí", "Presupuesto", "Vendido", "No compró"].map((e, i) => {
                          const activa = (paso >= 6 ? 3 : paso >= 4 ? 1 : 0) === i;
                          return (
                            <span
                              key={e}
                              className={cn(
                                "flex flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-medium transition-all duration-300",
                                activa ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground"
                              )}
                            >
                              <span className={cn("h-1.5 w-5 rounded-full", activa ? ["bg-sky-500", "bg-violet-500", "bg-orange-500", "bg-emerald-500", "bg-zinc-400"][i] : "bg-muted-foreground/25")} />
                              {e}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    {paso >= 6 && (
                      <div className="space-y-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.08] p-2.5 animate-in fade-in zoom-in-95 duration-500">
                        <p className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-4 w-4" /> ¡Venta anotada! {t.venta}
                        </p>
                        <p className="flex items-center gap-1.5 text-[11px]">
                          <Clapperboard className="h-3.5 w-3.5 text-primary" /> La trajo el video <b>«{t.video}»</b>
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Datos</p>
                      <div className="flex gap-1.5">
                        <span className="flex items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </span>
                        <span className="flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold">
                          <Phone className="h-3 w-3" /> Llamar
                        </span>
                      </div>
                      <div className="mt-1.5 rounded-xl border bg-card px-3 py-1.5">
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Lo trajo el video</p>
                        <p className="text-[12px] font-medium">{t.video}</p>
                      </div>
                    </div>
                    {paso < 6 && (
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Próximo paso</p>
                        <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white">
                            <BellRing className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-[11px]">
                            <b className="block">{paso >= 4 ? "Confirmar el pedido" : "Contestarle"}</b>
                            <span className="text-muted-foreground">Hoy</span>
                          </span>
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actividad</p>
                      <div className="space-y-1 text-[10.5px]">
                        {paso >= 5 && <p className="animate-in fade-in duration-500">• Abrió el link de {t.productos[0].nombre}</p>}
                        {paso >= 4 && <p className="animate-in fade-in duration-500">• Le mandaste 2 productos por WhatsApp</p>}
                        <p>• Escribió desde un anuncio de Meta</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---- El cursor ---- */}
          <div className="pointer-events-none absolute z-20 transition-all duration-700 ease-in-out motion-reduce:transition-none" style={{ left: cx, top: cy }}>
            <span className={cn("absolute -left-3 -top-3 h-8 w-8 rounded-full bg-primary/40 transition-all duration-300", clic ? "scale-100 opacity-100" : "scale-0 opacity-0")} />
            <MousePointer2 className={cn("relative h-6 w-6 fill-white text-zinc-900 drop-shadow-lg transition-transform duration-150", clic && "scale-90")} />
          </div>
        </div>
      </div>

      {/* Qué pasa en cada paso */}
      <div className="flex flex-col items-center gap-2">
        <p key={paso} className="min-h-[1.5rem] text-center text-sm font-semibold animate-in fade-in slide-in-from-bottom-1 duration-500 sm:text-base">
          <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-xs font-bold text-white">{paso + 1}</span>
          {PASOS[paso]}
        </p>
        <div className="flex gap-1.5">
          {PASOS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPaso(i)}
              aria-label={`Paso ${i + 1}`}
              className={cn("h-1.5 rounded-full transition-all duration-300", i === paso ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60")}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
