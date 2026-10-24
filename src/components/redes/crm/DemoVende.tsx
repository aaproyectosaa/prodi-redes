import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarCheck, CheckCircle2, Clapperboard, Heart, Lightbulb, MessageCircle, MousePointer2, Play, Send, Sparkles, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { temaDe } from "@/components/redes/crm/DemoContactos";

// Demo de "Qué te vende" para el CRM en Próximamente, como un video: alguien ve un Reel del negocio, escribe, le
// venden, la venta se suma a ese video y se ve cuál vende más; después la IA lee lo que preguntan los clientes y
// propone el próximo video. Datos de ejemplo según el rubro.

const ANCHO = 1000;
const ALTO = 560;

interface VideoDemo {
  titulo: string;
  monto: string;
  contactos: number;
  ventas: number;
  barra: number;
  color: string;
}
interface TemaVende {
  contacto: string;
  mensaje: string;
  venta: string;
  videos: VideoDemo[];
  costo: string;
  invertido: string;
  charlas: { nombre: string; antes: string; marca: string; despues: string }[];
  tema: string;
  idea: { titulo: string; texto: string };
}

const TEMAS: Record<ReturnType<typeof temaDe>, TemaVende> = {
  gastronomia: {
    contacto: "Marta",
    mensaje: "¡Hola! Vi el video de la promo, ¿sigue para este sábado?",
    venta: "$ 24.000",
    videos: [
      { titulo: "Promo 2x1 de los jueves", monto: "$ 240.000", contactos: 14, ventas: 9, barra: 100, color: "from-orange-400 to-red-500" },
      { titulo: "Cómo hacemos la masa madre", monto: "$ 96.500", contactos: 9, ventas: 4, barra: 40, color: "from-amber-300 to-orange-500" },
      { titulo: "Delivery hasta las 2 AM", monto: "$ 32.700", contactos: 6, ventas: 2, barra: 14, color: "from-rose-400 to-fuchsia-600" },
    ],
    costo: "$ 2.000",
    invertido: "$ 18.000",
    charlas: [
      { nombre: "Julián", antes: "Buenas! ", marca: "¿hacen delivery", despues: " a barrio Norte?" },
      { nombre: "Sofía", antes: "Hola, ", marca: "¿llegan con el delivery", despues: " hasta Las Flores?" },
      { nombre: "Lucas", antes: "Quiero 3 grandes, ", marca: "¿me la mandan", despues: " a casa?" },
      { nombre: "Ana", antes: "", marca: "¿El envío", despues: " tiene costo?" },
    ],
    tema: "¿Hacen delivery?",
    idea: { titulo: "Hasta tu puerta en 30 minutos", texto: "El repartidor sale con la pizza humeante y un mapa muestra los barrios a los que llegan. Cierra con «pedí por WhatsApp y te llega caliente»." },
  },
  servicios: {
    contacto: "Marcos",
    mensaje: "Hola, vi el video del local que dejaron en 3 días. ¿Me pasan presupuesto?",
    venta: "$ 850.000",
    videos: [
      { titulo: "Así dejamos un local en 3 días", monto: "$ 2.550.000", contactos: 11, ventas: 3, barra: 100, color: "from-sky-400 to-blue-600" },
      { titulo: "Tablero industrial paso a paso", monto: "$ 1.250.000", contactos: 7, ventas: 1, barra: 49, color: "from-violet-400 to-indigo-600" },
      { titulo: "3 errores en instalaciones", monto: "$ 120.000", contactos: 9, ventas: 1, barra: 6, color: "from-emerald-400 to-teal-600" },
    ],
    costo: "$ 9.000",
    invertido: "$ 27.000",
    charlas: [
      { nombre: "Laura", antes: "Hola, ", marca: "¿trabajan en el interior", despues: "? Estoy en Rafaela" },
      { nombre: "Estudio Ríos", antes: "", marca: "¿Viajan a otras ciudades", despues: " para una obra?" },
      { nombre: "Fábrica Norte", antes: "Tenemos planta en Esperanza, ", marca: "¿llegan hasta acá", despues: "?" },
      { nombre: "Pablo", antes: "", marca: "¿Cobran el traslado", despues: " si es fuera de la ciudad?" },
    ],
    tema: "¿Trabajan fuera de la ciudad?",
    idea: { titulo: "Vamos a donde esté tu obra", texto: "La camioneta del equipo saliendo a la ruta y un mapa con las ciudades donde ya trabajaron. Cierra con «pedí tu presupuesto sin cargo»." },
  },
  comercio: {
    contacto: "Lucía",
    mensaje: "¡Hola! Vi el video de lo más vendido, ¿tienen stock del pack x100?",
    venta: "$ 37.500",
    videos: [
      { titulo: "Lo más vendido del mes", monto: "$ 312.000", contactos: 16, ventas: 8, barra: 100, color: "from-violet-400 to-fuchsia-600" },
      { titulo: "Así preparamos tu pedido", monto: "$ 118.400", contactos: 10, ventas: 4, barra: 38, color: "from-sky-400 to-indigo-600" },
      { titulo: "Nuevos colores en stock", monto: "$ 45.200", contactos: 7, ventas: 2, barra: 14, color: "from-amber-300 to-orange-500" },
    ],
    costo: "$ 2.500",
    invertido: "$ 20.000",
    charlas: [
      { nombre: "Julián", antes: "Hola, ", marca: "¿hacen envíos al interior", despues: "?" },
      { nombre: "Sofía", antes: "Soy de Córdoba, ", marca: "¿me lo mandan", despues: "?" },
      { nombre: "Distribuidora Sur", antes: "", marca: "¿Con qué transporte envían", despues: "?" },
      { nombre: "Ana", antes: "", marca: "¿Cuánto tarda el envío", despues: " a Rosario?" },
    ],
    tema: "¿Hacen envíos al interior?",
    idea: { titulo: "Tu pedido llega a todo el país", texto: "El paquete armado, etiquetado y saliendo en el transporte, con un mapa de envíos. Cierra con «pedí hoy y te llega esta semana»." },
  },
};

const PASOS = [
  "Alguien ve tu video en Instagram y te escribe",
  "El CRM sabe qué video te trajo a ese cliente",
  "Cuando le vendés, la venta se suma a ese video",
  "Ves qué video te vende más, y cuánto te costó cada venta",
  "La IA lee lo que te escriben y encuentra lo que más se repite",
  "Y te propone el próximo video para responderlo",
];
const DURACION = [3600, 3400, 3600, 5200, 4600, 4800];
const CURSOR: [number, number][] = [
  [205, 448],
  [690, 230],
  [690, 330],
  [520, 300],
  [480, 470],
  [775, 440],
];

export function DemoVende({ rubro, negocio }: { rubro?: string | null; negocio?: string }) {
  const t = TEMAS[temaDe(rubro)];
  const [paso, setPaso] = useState(0);
  const [clic, setClic] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setEscala(Math.min(1.3, e.contentRect.width / ANCHO)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c1 = setTimeout(() => setClic(true), DURACION[paso] - 650);
    const c2 = setTimeout(() => setClic(false), DURACION[paso] - 350);
    const sig = setTimeout(() => setPaso((p) => (p + 1) % PASOS.length), DURACION[paso]);
    return () => [c1, c2, sig].forEach(clearTimeout);
  }, [paso]);
  const [cx, cy] = CURSOR[paso];
  const v0 = t.videos[0];
  const cuenta = (negocio || "tunegocio").toLowerCase().replace(/[^a-z0-9]+/g, "");

  return (
    <div className="space-y-3">
      <div ref={caja} className="relative w-full overflow-hidden rounded-2xl border bg-background shadow-xl" style={{ height: ALTO * escala }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: ANCHO, height: ALTO, transform: `scale(${escala})` }}>
          {/* ---- Escena 1: el Reel → el mensaje → el CRM ---- */}
          {paso <= 2 && (
            <div className="absolute inset-0 grid grid-cols-[380px_1fr] gap-6 bg-background p-6">
              {/* Celular */}
              <div className="mx-auto h-full w-[260px] overflow-hidden rounded-[2.2rem] border-[6px] border-zinc-800 bg-zinc-950 shadow-2xl">
                {paso === 0 ? (
                  <div className={cn("relative h-full bg-gradient-to-br", v0.color)}>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/30 backdrop-blur">
                        <Play className="ml-1 h-8 w-8 fill-white text-white" />
                      </span>
                    </div>
                    <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3 text-white">
                      <span className="h-7 w-7 rounded-full border-2 border-white bg-white/30" />
                      <span className="text-xs font-semibold">{cuenta}</span>
                      <span className="rounded bg-white/25 px-1.5 text-[9px]">Publicidad</span>
                    </div>
                    <div className="absolute right-3 top-1/2 flex flex-col items-center gap-3 text-white">
                      <Heart className="h-6 w-6 fill-white" />
                      <MessageCircle className="h-6 w-6" />
                      <Send className="h-6 w-6" />
                    </div>
                    <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/70 to-transparent p-3 pt-12 text-white">
                      <p className="text-sm font-bold">{v0.titulo}</p>
                      <span className="flex items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-xs font-bold text-zinc-900">
                        <MessageCircle className="h-4 w-4 text-emerald-600" /> Enviar mensaje
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col bg-[#0b141a] animate-in fade-in duration-300">
                    <div className="flex items-center gap-2 bg-[#202c33] p-3 text-white">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold">{t.contacto[0]}</span>
                      <span className="text-sm font-semibold">{t.contacto}</span>
                    </div>
                    <div className="flex-1 space-y-2 p-3">
                      <div className="rounded-lg bg-[#202c33] p-2 text-[10px] text-zinc-300">
                        <span className="mb-1 flex items-center gap-1 text-[9px] text-emerald-400">
                          <Clapperboard className="h-3 w-3" /> Desde el anuncio «{v0.titulo}»
                        </span>
                      </div>
                      <div className="max-w-[85%] rounded-lg rounded-tl-none bg-[#202c33] px-2.5 py-1.5 text-[12px] text-white">{t.mensaje}</div>
                      {paso === 2 && (
                        <div className="ml-auto max-w-[80%] rounded-lg rounded-tr-none bg-[#005c4b] px-2.5 py-1.5 text-[12px] text-white animate-in fade-in duration-500">
                          ¡Sí! Te lo reservo. ¿Pasás a las 21?
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* CRM */}
              <div className="flex flex-col justify-center gap-4">
                <div className="grid grid-cols-2 gap-3">
                  {["Nuevos", "Vendido"].map((col, i) => (
                    <div key={col} className={cn("h-[260px] space-y-2 rounded-2xl border border-t-4 bg-muted/40 p-2.5", i === 0 ? "border-t-sky-500" : "border-t-emerald-500")}>
                      <p className="text-xs font-semibold">{col}</p>
                      {((i === 0 && paso === 1) || (i === 1 && paso === 2)) && (
                        <div className={cn("rounded-xl border-2 bg-card p-3 shadow-lg animate-in fade-in zoom-in-95 duration-500", i === 1 ? "border-emerald-500/70" : "border-primary/70")}>
                          <p className="text-sm font-semibold">{t.contacto}</p>
                          <p className="line-clamp-2 text-[11px] text-foreground/75">“{t.mensaje}”</p>
                          <span className="mt-2 flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-semibold text-primary ring-2 ring-primary/30">
                            <Clapperboard className="h-3 w-3" /> Lo trajo: {v0.titulo}
                          </span>
                          {i === 1 && <span className="mt-1.5 inline-block rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">{t.venta}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className={cn("flex items-center gap-3 rounded-2xl border bg-card p-3 transition-all duration-500", paso === 2 ? "border-emerald-500/60 shadow-lg" : "opacity-50")}>
                  <span className={cn("h-11 w-11 shrink-0 rounded-lg bg-gradient-to-br", v0.color)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{v0.titulo}</p>
                    <p className="text-[11px] text-muted-foreground">Lo que vendió este video</p>
                  </div>
                  {paso === 2 && <span className="rounded-full bg-emerald-500 px-2.5 py-1 text-sm font-bold text-white animate-in fade-in slide-in-from-bottom-2 duration-500">+ {t.venta}</span>}
                </div>
              </div>
            </div>
          )}

          {/* ---- Escena 2: el ranking de videos ---- */}
          {paso === 3 && (
            <div className="absolute inset-0 space-y-4 bg-background p-8 animate-in fade-in duration-500">
              <p className="flex items-center gap-2 text-lg font-bold">
                <Clapperboard className="h-5 w-5 text-primary" /> Los videos que te vendieron · últimos 90 días
              </p>
              <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-primary/20 via-fuchsia-500/10 to-transparent p-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/30">
                  <Trophy className="h-6 w-6" />
                </span>
                <p className="text-base">
                  <b>«{v0.titulo}»</b> te vendió <b className="text-emerald-600 dark:text-emerald-400">{v0.monto}</b>. Invertiste {t.invertido} en publicidad: <b>cada venta te costó {t.costo}</b>.
                </p>
              </div>
              <div className="space-y-2.5">
                {t.videos.map((v, i) => (
                  <div key={v.titulo} className="flex items-center gap-4 rounded-2xl border bg-card p-3 animate-in fade-in slide-in-from-left-4 duration-500" style={{ animationDelay: `${i * 250}ms`, animationFillMode: "backwards" }}>
                    <span className="w-5 text-center text-lg font-bold text-muted-foreground">{i + 1}</span>
                    <span className={cn("relative flex h-14 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br", v.color)}>
                      <Play className="h-4 w-4 fill-white text-white" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="truncate text-sm font-semibold">{v.titulo}</p>
                      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500 animate-in slide-in-from-left-full duration-1000" style={{ width: `${v.barra}%`, animationDelay: `${300 + i * 250}ms`, animationFillMode: "backwards" }} />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {v.contactos} clientes te escribieron · {v.ventas} compraron
                      </p>
                    </div>
                    <span className="w-28 text-right text-lg font-bold text-emerald-600 dark:text-emerald-400">{v.monto}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---- Escena 3: lo que preguntan → el próximo video ---- */}
          {paso >= 4 && (
            <div className="absolute inset-0 grid grid-cols-2 gap-6 bg-background p-8 animate-in fade-in duration-500">
              <div className="space-y-2.5">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <MessageCircle className="h-4 w-4 text-emerald-600" /> Lo que te escribieron este mes
                </p>
                {t.charlas.map((c, i) => (
                  <div key={c.nombre} className="max-w-[92%] rounded-2xl rounded-bl-sm border bg-card px-3 py-2 text-[13px] shadow-sm animate-in fade-in slide-in-from-left-3 duration-500" style={{ animationDelay: `${i * 300}ms`, animationFillMode: "backwards" }}>
                    <p className="text-[10px] font-semibold text-muted-foreground">{c.nombre}</p>
                    {c.antes}
                    <mark className="rounded bg-amber-400/40 px-0.5 text-foreground">
                      {c.marca}
                    </mark>
                    {c.despues}
                  </div>
                ))}
              </div>
              <div className="flex flex-col justify-center gap-4">
                <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm animate-in fade-in zoom-in-95 duration-500 [animation-delay:1200ms] [animation-fill-mode:backwards]">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-white">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lo que más te preguntan</p>
                    <p className="text-base font-bold">{t.tema}</p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">{t.charlas.length} personas este mes</p>
                  </div>
                </div>
                {paso === 5 && (
                  <div className="space-y-2 rounded-2xl bg-gradient-to-br from-primary/[0.15] to-fuchsia-500/[0.1] p-4 ring-1 ring-primary/30 animate-in fade-in slide-in-from-bottom-3 duration-500">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                      <Lightbulb className="h-3.5 w-3.5" /> Tu próximo video
                    </p>
                    <p className="text-lg font-bold">{t.idea.titulo}</p>
                    <p className="text-[13px] text-foreground/80">{t.idea.texto}</p>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 animate-in fade-in duration-500 [animation-delay:1500ms] [animation-fill-mode:backwards] dark:text-emerald-300">
                      <CalendarCheck className="h-3.5 w-3.5" /> Prodi lo suma a tu plan del mes
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---- Cursor ---- */}
          <div className="pointer-events-none absolute z-20 transition-all duration-700 ease-in-out motion-reduce:transition-none" style={{ left: cx, top: cy }}>
            <span className={cn("absolute -left-3 -top-3 h-8 w-8 rounded-full bg-primary/40 transition-all duration-300", clic ? "scale-100 opacity-100" : "scale-0 opacity-0")} />
            <MousePointer2 className={cn("relative h-6 w-6 fill-white text-zinc-900 drop-shadow-lg transition-transform duration-150", clic && "scale-90")} />
          </div>
        </div>
      </div>

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
