import { useEffect, useState } from "react";
import { Moon, X } from "lucide-react";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { ahoraAR, esHorarioDescanso, leerDescanso, ROLES_CON_DESCANSO } from "../../api/_lib/descanso";

const CLAVE = "prodi-aviso-tarde";
/** La noche a la que pertenece ahora (de madrugada cuenta como la noche anterior), para avisar una vez por noche. */
const nocheDe = (d: Date) => new Date(d.getTime() - 8 * 3600_000).toISOString().slice(0, 10);
const leer = () => {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
};

/**
 * Si alguien del equipo sigue usando la app en su horario de descanso, una vez por noche le recordamos que ya es tarde
 * (y que los avisos están en pausa hasta la mañana). No aplica al super admin ni a los clientes.
 */
export function AvisoTarde() {
  const { settings } = useRedes();
  const { realRole, roles, viewingAs } = useUserProfileContext();
  const [ver, setVer] = useState(false);
  const d = leerDescanso(settings);
  // Por ahora también le aparece al admin, para probarlo.
  const delEquipo = !viewingAs && (realRole === "admin" || (roles ?? [realRole]).some((r) => ROLES_CON_DESCANSO.includes(String(r))));

  useEffect(() => {
    if (!delEquipo || !d.activo) return;
    const revisar = () => {
      const ahora = new Date();
      // Domingo de día no: el aviso es para la noche.
      const { hora } = ahoraAR(ahora);
      const deNoche = d.desde > d.hasta ? hora >= d.desde || hora < d.hasta : hora >= d.desde && hora < d.hasta;
      if (deNoche && esHorarioDescanso(d, ahora) && leer() !== nocheDe(ahora)) setVer(true);
    };
    revisar();
    const t = window.setInterval(revisar, 60_000);
    return () => window.clearInterval(t);
  }, [delEquipo, d.activo, d.desde, d.hasta, d.domingo]);

  if (!ver) return null;
  const cerrar = () => {
    try {
      localStorage.setItem(CLAVE, nocheDe(new Date()));
    } catch {
      /* sin almacenamiento: igual se cierra */
    }
    setVer(false);
  };
  const { hora, minuto } = ahoraAR();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-6">
      <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border bg-card/95 p-4 shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white">
          <Moon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            Ya son las {hora}:{String(minuto).padStart(2, "0")} 🌙
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Lo que falta sigue mañana. Los avisos están en pausa hasta las {d.hasta}:00. ¡A descansar!
          </p>
          <button type="button" onClick={cerrar} className="mt-2 text-sm font-semibold text-primary hover:underline">
            Entendido
          </button>
        </div>
        <button type="button" onClick={cerrar} className="-mr-1 -mt-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
