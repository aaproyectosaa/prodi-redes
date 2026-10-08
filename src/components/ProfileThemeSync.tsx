import { useEffect } from "react";
import { useTheme } from "@/hooks/use-theme";
import { temaElegido } from "@/lib/tema";
import { useUserProfileContext } from "@/contexts/user-profile-context";

/**
 * El tema del perfil solo se usa si en este dispositivo todavía no se eligió uno: si no, al recargar
 * volvía al del perfil (muchos quedaron en "dark" del sistema anterior) y se perdía el modo claro.
 */
export function ProfileThemeSync() {
  const { setTheme } = useTheme();
  const { profile } = useUserProfileContext();

  useEffect(() => {
    if (temaElegido()) return;
    if (profile?.theme === "light" || profile?.theme === "dark") {
      setTheme(profile.theme);
    }
  }, [profile?.theme, setTheme]);
  return null;
}
