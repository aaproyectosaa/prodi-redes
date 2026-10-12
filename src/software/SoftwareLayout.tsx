// Marco de las pantallas de Prodi Software (mismo diseño que el resto de Prodi) y entra en la empresa Software.

import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useEmpresa } from "@/lib/empresa";
import { swFetch } from "./compat";

export default function SoftwareLayout() {
  const { empresa, cambiar } = useEmpresa();
  const { roles } = useUserProfileContext();
  const direccion = roles.some((r) => r === "admin" || r === "administracion");
  useEffect(() => {
    if (empresa !== "software") cambiar("software");
  }, [empresa, cambiar]);
  // Como en MP Socios: al abrir el panel trae de Mercado Pago lo nuevo (cada 15 minutos como mucho).
  useEffect(() => {
    if (!direccion) return;
    try {
      const clave = "prodi-software-sync";
      if (Date.now() - Number(sessionStorage.getItem(clave) || 0) < 15 * 60 * 1000) return;
      sessionStorage.setItem(clave, String(Date.now()));
    } catch {
      /* sin storage: igual sincroniza */
    }
    swFetch("/api/sync", { method: "POST" }).catch(() => undefined);
  }, [direccion]);
  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-5 pb-mobile-nav md:px-8 md:py-8 md:pb-8">
      <Outlet />
    </div>
  );
}

/** Inicio de Software: dirección ve el panel; programación, sus ganancias. */
export function InicioSoftware({ panel }: { panel: React.ReactNode }) {
  const { roles } = useUserProfileContext();
  if (!roles.some((r) => r === "admin" || r === "administracion")) return <Navigate to="/software/mis-ganancias" replace />;
  return <>{panel}</>;
}
