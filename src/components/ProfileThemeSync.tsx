import { useEffect } from "react";
import { useTheme } from "@/hooks/use-theme";
import { useUserProfileContext } from "@/contexts/user-profile-context";

export function ProfileThemeSync() {
  const { setTheme } = useTheme();
  const { profile } = useUserProfileContext();

  useEffect(() => {
    if (profile?.theme === "light" || profile?.theme === "dark") {
      setTheme(profile.theme);
    }
  }, [profile?.theme, setTheme]);  return null;
}
