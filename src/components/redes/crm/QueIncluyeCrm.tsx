import {
  BellRing,
  CalendarCheck,
  Clapperboard,
  Contact,
  Image as ImageIcon,
  Lock,
  MessageCircle,
  MessageCircleQuestion,
  Package,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

// "Qué incluye" (CRM): todo lo que tiene el CRM, explicado en texto. Se ve en Próximamente y con el CRM activo.

interface Parte {
  icono: React.ElementType;
  titulo: string;
  resumen: string;
  items: { titulo: string; texto: string }[];
  color: string;
}

const PARTES: Parte[] = [
  {
    icono: Contact,
    titulo: "Mis contactos",
    resumen: "Todos los que te escriben, en un solo tablero, desde el primer mensaje hasta la venta.",
    color: "from-sky-500 to-violet-500",
    items: [
      { titulo: "Entran solos", texto: "Cada persona que te escribe por WhatsApp, Instagram o Facebook aparece como contacto nuevo, con lo que preguntó y desde dónde llegó." },
      { titulo: "Un tablero por etapas", texto: "Nuevos, Les escribí, Presupuesto, Vendido y No compró. Los movés arrastrando y ves de un vistazo en qué está cada uno." },
      { titulo: "La ficha con el chat", texto: "Abrís un contacto y ves toda la charla, sus datos y su historial. Le respondés desde ahí por la red que eligió." },
      { titulo: "Fotos, videos y productos", texto: "Le mandás tus videos (los que hizo Prodi o los tuyos), fotos y productos de tu tienda web con precio. Cada link te avisa cuando lo abre." },
      { titulo: "Respuestas rápidas y notas", texto: "Mensajes guardados para lo que más te preguntan y notas internas que el cliente no ve." },
      { titulo: "Anotás la venta", texto: "Cuando te compra, ponés cuánto y queda sumado a lo que vendiste en el mes." },
    ],
  },
  {
    icono: BellRing,
    titulo: "Seguimiento",
    resumen: "Que nadie quede sin respuesta y que ninguna venta se enfríe.",
    color: "from-amber-500 to-orange-500",
    items: [
      { titulo: "Tu lista del día", texto: "Todos los días te muestra a quién contestarle y a quién volver a escribirle." },
      { titulo: "Próximo paso con fecha", texto: "Le ponés qué sigue (pasar precio, confirmar el pedido) y cuándo. Te lo recuerda ese día." },
      { titulo: "Registrás todo", texto: "Llamadas, visitas al local y mails quedan en la actividad de cada contacto." },
    ],
  },
  {
    icono: Trophy,
    titulo: "Qué te vende",
    resumen: "Lo que ningún otro CRM te puede mostrar, porque Prodi hace tus videos y maneja tu publicidad.",
    color: "from-primary to-fuchsia-500",
    items: [
      { titulo: "El video que trajo cada venta", texto: "Cada contacto queda atado al video o anuncio que lo trajo. Sabés qué video te vendió y cuánto." },
      { titulo: "Cuánto te costó cada venta", texto: "Cruzamos lo que vendió cada video con lo que se invirtió en publicidad: ves el costo real de cada venta." },
      { titulo: "Lo que más te preguntan", texto: "La IA lee tus charlas y encuentra lo que se repite: dudas, objeciones y pedidos." },
      { titulo: "Tu próximo video", texto: "Para cada cosa que se repite te propone un video que la responda, y Prodi lo usa para armar tu plan del mes." },
    ],
  },
  {
    icono: Users,
    titulo: "Equipo",
    resumen: "Si tenés gente que atiende y vende, cada uno con lo suyo.",
    color: "from-emerald-500 to-teal-500",
    items: [
      { titulo: "Tus vendedores", texto: "Cargás a quienes contestan los mensajes. Podés pausar a uno cuando no está." },
      { titulo: "Reparto automático", texto: "Cada contacto nuevo va al vendedor que tiene menos trabajo. Igual lo podés cambiar." },
      { titulo: "Cómo le va a cada uno", texto: "Ventas, plata vendida y qué parte de sus contactos compró." },
      { titulo: "Su lista del día por WhatsApp", texto: "Con un toque le mandás a cada vendedor a quién tiene que escribirle hoy." },
    ],
  },
];

export function QueIncluyeCrm({ pronto }: { pronto?: boolean }) {
  return (
    <div className="space-y-5">
      <div className="rounded-3xl border bg-gradient-to-br from-primary/12 via-fuchsia-500/[0.07] to-transparent p-5 sm:p-7">
        {pronto && (
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-3 py-1 text-xs font-bold text-white shadow-md shadow-primary/25">
            <Sparkles className="h-3.5 w-3.5" /> Próximamente
          </span>
        )}
        <h2 className="max-w-2xl text-2xl font-bold leading-tight sm:text-3xl">Tu CRM: cada mensaje, hasta la venta, conectado a tus videos</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Un CRM es el lugar donde ordenás a todos los que te consultan para que ninguno se pierda y más terminen comprando. El de Prodi además te dice qué video te
          trajo cada venta y qué video conviene hacer después.
        </p>
        {pronto && (
          <p className="mt-3 flex max-w-2xl items-start gap-2 rounded-xl bg-background/60 p-3 text-sm">
            <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Ya está listo. Lo activamos apenas Meta termine de habilitar la conexión con WhatsApp, Instagram y Facebook, para que tus mensajes entren solos. Te avisamos.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {PARTES.map((p) => (
          <section key={p.titulo} className="space-y-3 rounded-2xl border bg-card p-5">
            <div className="flex items-start gap-3">
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md", p.color)}>
                <p.icono className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-lg font-bold">{p.titulo}</h3>
                <p className="text-sm text-muted-foreground">{p.resumen}</p>
              </div>
            </div>
            <ul className="space-y-2.5">
              {p.items.map((it) => (
                <li key={it.titulo} className="flex gap-2.5">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gradient-to-br", p.color)} />
                  <span className="text-sm">
                    <b>{it.titulo}.</b> <span className="text-muted-foreground">{it.texto}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icono: MessageCircle, titulo: "Por donde te escriban", texto: "WhatsApp, Instagram y Facebook, todo en el mismo lugar." },
          { icono: Lock, titulo: "Tus datos son tuyos", texto: "Tus contactos los ven solo vos, tu equipo y Prodi. No se comparten con nadie." },
          { icono: Package, titulo: "Solo tu tienda", texto: "El catálogo trae productos únicamente de tu propia web, comprobada." },
        ].map((x) => (
          <div key={x.titulo} className="flex gap-3 rounded-2xl border bg-card p-4">
            <x.icono className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-semibold">{x.titulo}</span>
              <span className="block text-xs text-muted-foreground">{x.texto}</span>
            </span>
          </div>
        ))}
      </div>

      <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clapperboard className="h-3.5 w-3.5" /> Conectado a tus videos
        </span>
        <span className="flex items-center gap-1">
          <ImageIcon className="h-3.5 w-3.5" /> Tus fotos y productos en el chat
        </span>
        <span className="flex items-center gap-1">
          <MessageCircleQuestion className="h-3.5 w-3.5" /> La IA te dice qué te preguntan
        </span>
      </p>
    </div>
  );
}
