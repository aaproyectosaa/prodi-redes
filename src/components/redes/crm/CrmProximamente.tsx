import { BellRing, Clapperboard, Contact, MessageCircleQuestion, Package, Sparkles, Trophy, Users } from "lucide-react";

// CRM en "Próximamente": el cliente ya lo ve en su menú, pero todavía no lo puede usar (falta que Meta habilite la
// app para que los mensajes entren solos). Le mostramos lo que va a poder hacer.

const QUE_VAS_A_PODER = [
  { icono: Contact, titulo: "Todos tus contactos en un tablero", texto: "Los que te escriben por WhatsApp, Instagram y Facebook entran solos y los vas moviendo hasta que compran." },
  { icono: BellRing, titulo: "A quién escribirle hoy", texto: "Cada día te avisa quién está esperando respuesta y a quién volver a escribirle." },
  { icono: Trophy, titulo: "Qué video te vendió", texto: "Vas a ver qué video trajo cada venta, cuánto vendió y cuánto te costó cada venta en publicidad." },
  { icono: MessageCircleQuestion, titulo: "Lo que más te preguntan", texto: "La IA lee tus charlas y lo que se repite lo convertimos en tus próximos videos." },
  { icono: Package, titulo: "Tus productos en el chat", texto: "Mandás fotos, videos y productos de tu tienda con un toque, y te avisa cuando los abren." },
  { icono: Users, titulo: "Tu equipo de ventas", texto: "Repartí los contactos entre tus vendedores y mirá cómo le va a cada uno." },
];

export function CrmProximamente() {
  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/15 via-fuchsia-500/10 to-transparent p-6 sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-3 py-1 text-xs font-bold text-white shadow-md shadow-primary/25">
          <Sparkles className="h-3.5 w-3.5" /> Próximamente
        </span>
        <h2 className="mt-4 max-w-xl text-2xl font-bold leading-tight sm:text-3xl">Tu CRM de ventas, conectado a tus videos y a tu publicidad</h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Ya lo tenés listo. Lo activamos apenas Meta termine de habilitar la conexión con WhatsApp, Instagram y Facebook, para que tus mensajes entren solos. Te
          avisamos.
        </p>
        <Clapperboard className="pointer-events-none absolute -bottom-6 -right-6 h-40 w-40 text-primary/10" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUE_VAS_A_PODER.map(({ icono: I, titulo, texto }) => (
          <div key={titulo} className="rounded-2xl border bg-card p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white">
              <I className="h-4 w-4" />
            </span>
            <p className="mt-3 text-sm font-semibold">{titulo}</p>
            <p className="mt-1 text-xs text-muted-foreground">{texto}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
