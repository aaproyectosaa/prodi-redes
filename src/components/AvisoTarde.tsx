import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { ahoraAR, esHorarioDescanso, leerDescanso, ROLES_CON_DESCANSO } from "../../api/_lib/descanso";

const CLAVE = "prodi-aviso-tarde-2";
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-500">
      <style>{NOCHE_CSS}</style>
      <div className="noche-cielo relative w-full max-w-sm overflow-hidden rounded-[2rem] text-white shadow-2xl animate-in zoom-in-90 duration-700">
        {/* Estrellas que titilan */}
        {ESTRELLAS.map((e, i) => (
          <span
            key={i}
            className="noche-estrella absolute rounded-full bg-white"
            style={{ left: `${e.x}%`, top: `${e.y}%`, width: e.t, height: e.t, animationDelay: `${e.d}s` }}
          />
        ))}
        {/* Una estrella fugaz */}
        <span className="noche-fugaz absolute left-[10%] top-[12%] h-px w-16 bg-gradient-to-r from-transparent via-white to-transparent" />

        <button
          type="button"
          onClick={cerrar}
          className="absolute right-3 top-3 z-10 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative flex flex-col items-center px-6 pb-7 pt-10 text-center">
          {/* La luna, flotando, con su brillo y los "Z" que suben */}
          <div className="relative mb-6 h-32 w-32">
            <span className="noche-brillo absolute inset-0 rounded-full bg-amber-200/30 blur-2xl" />
            <div className="noche-luna relative h-32 w-32">
              <span className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-50 via-amber-100 to-amber-300 shadow-[0_0_60px_rgba(253,230,138,0.55)]" />
              {/* Sombra que la vuelve medialuna */}
              <span className="absolute -right-3 -top-3 h-28 w-28 rounded-full bg-[#1b1442]" />
              {/* Carita dormida */}
              <span className="absolute left-[22%] top-[44%] h-1.5 w-4 rounded-b-full border-b-2 border-amber-700/60" />
              <span className="absolute left-[30%] top-[64%] h-1 w-3 rounded-b-full border-b-2 border-amber-700/50" />
            </div>
            <span className="noche-z absolute -right-1 top-2 text-2xl font-black text-white/90" style={{ animationDelay: "0s" }}>Z</span>
            <span className="noche-z absolute right-4 top-0 text-lg font-black text-white/80" style={{ animationDelay: "1s" }}>z</span>
            <span className="noche-z absolute right-9 -top-1 text-sm font-black text-white/70" style={{ animationDelay: "2s" }}>z</span>
          </div>

          <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-200/80">Ya son las</p>
          <p className="mt-1 text-6xl font-black tabular-nums tracking-tight">
            {hora}:{String(minuto).padStart(2, "0")}
          </p>
          <p className="mt-4 text-xl font-bold">Hora de descansar 🌙</p>
          <p className="mt-2 text-sm leading-relaxed text-violet-100/80">
            Lo que falta sigue mañana. Los avisos quedan en pausa hasta las {d.hasta}:00 para que puedas desconectar.
          </p>
          <button
            type="button"
            onClick={cerrar}
            className="mt-7 h-14 w-full rounded-2xl bg-white text-base font-bold text-[#1b1442] shadow-lg shadow-black/30 transition-transform active:scale-[0.98]"
          >
            Buenas noches 💤
          </button>
        </div>
      </div>
    </div>
  );
}

/** Estrellas fijas (posición, tamaño y cuándo titilan). */
const ESTRELLAS = Array.from({ length: 34 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: r(1) * 100, y: r(2) * 60, t: r(3) > 0.8 ? 3 : r(3) > 0.4 ? 2 : 1, d: r(4) * 3 };
});

const NOCHE_CSS = `
.noche-cielo { background: radial-gradient(120% 80% at 50% 0%, #3b2a8a 0%, #1b1442 45%, #0b0820 100%); }
.noche-estrella { opacity: .3; animation: noche-titila 3s ease-in-out infinite; }
@keyframes noche-titila { 0%, 100% { opacity: .2; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.2); } }
.noche-luna { animation: noche-flota 6s ease-in-out infinite; }
@keyframes noche-flota { 0%, 100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-10px) rotate(4deg); } }
.noche-brillo { animation: noche-pulso 4s ease-in-out infinite; }
@keyframes noche-pulso { 0%, 100% { opacity: .5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.15); } }
.noche-z { opacity: 0; animation: noche-sube 3s ease-in infinite; }
@keyframes noche-sube { 0% { opacity: 0; transform: translate(0, 10px) scale(.6); } 25% { opacity: 1; } 100% { opacity: 0; transform: translate(18px, -40px) scale(1.2); } }
.noche-fugaz { opacity: 0; transform: rotate(-25deg); animation: noche-fugaz 7s ease-out infinite 1.5s; }
@keyframes noche-fugaz { 0% { opacity: 0; transform: translate(0, 0) rotate(-25deg); } 4% { opacity: 1; } 12% { opacity: 0; transform: translate(220px, 100px) rotate(-25deg); } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .noche-estrella, .noche-luna, .noche-brillo, .noche-z, .noche-fugaz { animation: none; } .noche-z { opacity: .8; } }
`;
