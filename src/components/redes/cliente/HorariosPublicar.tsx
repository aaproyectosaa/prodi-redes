import { Clock, Lightbulb } from "lucide-react";
import type { Project } from "@/integrations/firebase/types";
import { rubroPauta } from "../../../../api/_lib/pauta-rubros";

// Para los clientes que suben ellos sus videos: a qué hora conviene publicar. Si Meta da cuándo están conectados sus
// seguidores (api/_lib/ig-horarios.ts), salen de ahí; si no, los recomendados para su rubro en Argentina.

interface Franja {
  desde: number;
  hasta: number;
}

/** Horarios que mejor funcionan en Instagram en Argentina, por rubro. */
const POR_RUBRO: Record<string, { franjas: Franja[]; dias: string }> = {
  gastronomia: { franjas: [{ desde: 11, hasta: 12 }, { desde: 19, hasta: 21 }], dias: "de jueves a domingo" },
  salud_estetica: { franjas: [{ desde: 8, hasta: 9 }, { desde: 13, hasta: 14 }, { desde: 20, hasta: 22 }], dias: "de lunes a jueves" },
  fitness: { franjas: [{ desde: 7, hasta: 8 }, { desde: 18, hasta: 20 }], dias: "de lunes a jueves" },
  indumentaria: { franjas: [{ desde: 13, hasta: 14 }, { desde: 21, hasta: 23 }], dias: "de miércoles a sábado" },
  automotor: { franjas: [{ desde: 12, hasta: 14 }, { desde: 19, hasta: 21 }], dias: "de martes a sábado" },
  construccion_industria: { franjas: [{ desde: 8, hasta: 10 }, { desde: 12, hasta: 13 }, { desde: 18, hasta: 19 }], dias: "de lunes a viernes" },
  servicios: { franjas: [{ desde: 8, hasta: 10 }, { desde: 12, hasta: 13 }, { desde: 19, hasta: 20 }], dias: "de lunes a viernes" },
  educacion: { franjas: [{ desde: 12, hasta: 13 }, { desde: 19, hasta: 21 }], dias: "de lunes a jueves" },
  hogar: { franjas: [{ desde: 13, hasta: 14 }, { desde: 20, hasta: 22 }], dias: "de miércoles a domingo" },
  otro: { franjas: [{ desde: 12, hasta: 14 }, { desde: 19, hasta: 22 }], dias: "de martes a jueves" },
};

const hora = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** Las 3 mejores franjas de 1 hora según cuándo están conectados sus seguidores (separadas por al menos 2 h). */
function desdeSeguidores(horas: number[]): Franja[] {
  const orden = horas.map((v, h) => ({ h, v })).sort((a, b) => b.v - a.v);
  const elegidas: number[] = [];
  for (const x of orden) {
    if (x.h < 7 && x.h > 1) continue; // de madrugada no se recomienda
    if (elegidas.every((h) => Math.min(Math.abs(h - x.h), 24 - Math.abs(h - x.h)) >= 2)) elegidas.push(x.h);
    if (elegidas.length === 3) break;
  }
  // Un rato antes del pico: así el video ya está arriba cuando se conectan.
  return elegidas.sort((a, b) => a - b).map((h) => ({ desde: (h + 23) % 24, hasta: h }));
}

export function HorariosPublicar({ cliente }: { cliente: Project }) {
  const datos = (cliente as Project & { ig_horarios?: { horas?: number[]; dias?: number } | null }).ig_horarios;
  const reales = datos?.horas?.length === 24 && datos.horas.some((x) => x > 0);
  const base = POR_RUBRO[rubroPauta(cliente as unknown as Record<string, unknown>)] ?? POR_RUBRO.otro;
  const franjas = reales ? desdeSeguidores(datos!.horas!) : base.franjas;

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white">
          <Clock className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Mejores horarios para publicar</p>
          <p className="text-xs text-muted-foreground">
            {reales ? "Según cuándo están conectados tus seguidores en Instagram (últimos días)." : "Los que mejor funcionan para tu rubro en Argentina."}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {franjas.map((f) => (
          <span key={`${f.desde}-${f.hasta}`} className="rounded-xl bg-primary/10 px-3 py-2 text-sm font-bold tabular-nums text-primary">
            {hora(f.desde)} a {hora(f.hasta)}
          </span>
        ))}
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        {reales ? "Publicá un rato antes de esa hora, así el video ya está arriba cuando se conectan." : `Mejor ${base.dias}. Publicá al principio de la franja y respondé los comentarios en la primera hora.`}
      </p>
    </section>
  );
}
