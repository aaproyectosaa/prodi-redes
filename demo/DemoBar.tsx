import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { DEMO_UID_KEY } from "./auth-mock";
import { resetDemo } from "./firestore-mock";

const PERSONAS = [
  { uid: "u_lucas", label: "Lucas · Super admin" },
  { uid: "u_lucia", label: "Lucía · Producción" },
  { uid: "u_nati", label: "Natalia · Edición" },
  { uid: "u_eze", label: "Ezequiel · Pauta" },
  { uid: "u_ivan", label: "Iván · Pauta" },
  { uid: "u_karen", label: "Karen · Diseño" },
  { uid: "u_admin", label: "Lucii · Administración" },
  { uid: "u_cli1", label: "Martín · cliente Don Tano" },
  { uid: "u_cli2", label: "Carla · cliente Ópticas" },
];

function current() {
  try {
    return localStorage.getItem(DEMO_UID_KEY) || "u_lucas";
  } catch {
    return "u_lucas";
  }
}

/** Barra de la demo: elegir con qué rol mirar el sistema. */
export function DemoBar() {
  const [uid] = useState(current);
  useEffect(() => {
    const onOut = () => toast.message("Demo: para cambiar de usuario usá el selector de arriba.");
    window.addEventListener("demo-signout", onOut);
    return () => window.removeEventListener("demo-signout", onOut);
  }, []);
  const go = (next: string) => {
    try {
      localStorage.setItem(DEMO_UID_KEY, next);
    } catch {
      /* ignore */
    }
    window.location.hash = "#/";
    window.location.reload();
  };
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-white/10 bg-prodi px-3 text-xs text-white">
      <span className="hidden font-semibold sm:inline">DEMO</span>
      <span className="hidden opacity-80 md:inline">Datos de ejemplo · ver como:</span>
      <select
        value={uid}
        onChange={(e) => go(e.target.value)}
        className="h-7 w-56 min-w-0 rounded-md border border-white/30 bg-[#2a1670] px-2 text-xs font-medium text-white outline-none"
      >
        {PERSONAS.map((p) => (
          <option key={p.uid} value={p.uid} className="text-black">
            {p.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          resetDemo();
          window.location.hash = "#/";
          window.location.reload();
        }}
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-white/15"
        title="Volver a los datos iniciales"
      >
        <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Reiniciar</span>
      </button>
    </div>
  );
}
