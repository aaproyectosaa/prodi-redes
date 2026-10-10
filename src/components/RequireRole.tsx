import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import type { UserRole } from "@/integrations/firebase/types";

/** Bloquea una pantalla a los roles que no corresponden (los manda a su inicio). */
export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { role, roles: misRoles, loading } = useUserProfileContext();
  if (loading || !role) {
    return <div className="p-8 text-sm text-muted-foreground">Cargando…</div>;
  }
  if (role === "pending") return null;
  if (!misRoles.some((r) => roles.includes(r))) return <Navigate to="/" replace />;
  return <>{children}</>;
}
