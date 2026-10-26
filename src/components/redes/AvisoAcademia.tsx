import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GraduationCap, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { avanceDe, cursosDe, useProgresoAcademia } from "@/lib/redes/academia";

/** Lecciones que le faltan a la persona en sus cursos de la Academia (0 si no tiene curso o ya terminó). */
export function useFaltanAcademia(): number {
  const { user, role, roles } = useUserProfileContext();
  const progreso = useProgresoAcademia(user?.uid);
  return useMemo(() => {
    if (!progreso) return 0;
    return cursosDe([role ?? "", ...(roles ?? [])]).reduce((n, c) => {
      const a = avanceDe(c, progreso);
      return n + a.total - a.hechas;
    }, 0);
  }, [progreso, role, roles]);
}

const CLAVE = "prodi-aviso-academia";
const hoy = () => new Date().toISOString().slice(0, 10);

/** Barra arriba del panel: invita a hacer el curso de la Academia hasta terminarlo (se puede cerrar por hoy). */
export function AvisoAcademia() {
  const faltan = useFaltanAcademia();
  const { profile } = useUserProfileContext();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [cerrado, setCerrado] = useState(() => {
    try {
      return localStorage.getItem(CLAVE) === hoy();
    } catch {
      return false;
    }
  });
  if (!faltan || cerrado || pathname.startsWith("/academia")) return null;
  const capacitacion = !!profile?.en_capacitacion;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-gradient-to-r from-primary/15 via-fuchsia-500/10 to-transparent px-4 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <GraduationCap className="h-5 w-5" />
      </span>
      <button type="button" onClick={() => navigate("/academia")} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold leading-tight">
          {capacitacion ? "Completá tu curso en la Academia Prodi" : "Nuevo: Academia Prodi"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {faltan === 1 ? "Te falta 1 lección" : `Te faltan ${faltan} lecciones`} · videos cortos de un par de minutos
        </p>
      </button>
      <Button size="sm" className="shrink-0" onClick={() => navigate("/academia")}>
        Ver la Academia
      </Button>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(CLAVE, hoy());
          } catch {
            /* sin almacenamiento: se cierra solo por esta vez */
          }
          setCerrado(true);
        }}
        className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
        aria-label="Cerrar por hoy"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
