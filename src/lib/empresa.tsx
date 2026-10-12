// Empresas de Prodi: Prodi Redes (videos y pauta) y Prodi Software (apps con Mercado Pago).
// Como cambiar de cuenta en Facebook: cada persona ve las empresas donde trabaja y elige en cuál está.
//   · Redes: el equipo de redes, administración, el admin y los clientes.
//   · Software: el admin, administración y programación.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import type { UserRole } from "@/integrations/firebase/types";

export type Empresa = "redes" | "software";

export const EMPRESAS: Record<Empresa, { nombre: string; corto: string; inicio: string }> = {
  redes: { nombre: "Prodi Redes", corto: "Redes", inicio: "/" },
  software: { nombre: "Prodi Software", corto: "Software", inicio: "/software" },
};

const DE_REDES: UserRole[] = ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"];
const DE_SOFTWARE: UserRole[] = ["admin", "administracion", "programador"];

/** Empresas donde trabaja alguien con estos roles (principal + adicionales). */
export function empresasDe(roles: UserRole[]): Empresa[] {
  const out: Empresa[] = [];
  if (roles.some((r) => DE_REDES.includes(r))) out.push("redes");
  if (roles.some((r) => DE_SOFTWARE.includes(r))) out.push("software");
  return out;
}

const CLAVE = "prodi-empresa";
const leer = (): Empresa | null => {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === "redes" || v === "software" ? v : null;
  } catch {
    return null;
  }
};

interface EmpresaCtx {
  empresa: Empresa;
  disponibles: Empresa[];
  cambiar: (e: Empresa) => void;
}

const Ctx = createContext<EmpresaCtx | null>(null);

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const { roles } = useUserProfileContext();
  const disponibles = useMemo(() => empresasDe(roles), [roles]);
  const [elegida, setElegida] = useState<Empresa | null>(leer);
  // La elegida, si la tiene; si no, la primera donde trabaja (o Redes, mientras carga).
  const empresa: Empresa = elegida && disponibles.includes(elegida) ? elegida : disponibles[0] ?? "redes";
  const cambiar = useCallback((e: Empresa) => {
    setElegida(e);
    try {
      localStorage.setItem(CLAVE, e);
    } catch {
      /* sin localStorage: dura lo que la pestaña */
    }
  }, []);
  const value = useMemo(() => ({ empresa, disponibles, cambiar }), [empresa, disponibles, cambiar]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEmpresa(): EmpresaCtx {
  const c = useContext(Ctx);
  return c ?? { empresa: "redes", disponibles: ["redes"], cambiar: () => undefined };
}
