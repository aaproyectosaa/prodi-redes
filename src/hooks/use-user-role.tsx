import { useUserProfileContext } from "@/contexts/user-profile-context";
import type { UserRole } from "@/integrations/firebase/types";

/**
 * Devuelve el rol del usuario actual desde el contexto compartido
 * (un solo listener de Firestore por sesión).
 */
export const useUserRole = (_userId?: string) => {
  void _userId;
  const { role, loading, isAdmin } = useUserProfileContext();
  return { role, loading, isAdmin };
};

export type { UserRole };
