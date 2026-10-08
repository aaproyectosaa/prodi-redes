import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CLAVE_TEMA, temaElegido } from "@/lib/tema";

type Theme = "light" | "dark";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "light",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = CLAVE_TEMA,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => temaElegido(storageKey) ?? defaultTheme);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  const setTheme = useCallback(
    (nextTheme: Theme) => {
      try {
        localStorage.setItem(storageKey, nextTheme);
      } catch {
        // Sin almacenamiento (modo privado): vale hasta que se cierre la página.
      }
      setThemeState(nextTheme);
    },
    [storageKey]
  );

  const value = useMemo(
    () => ({
      theme,
      setTheme,
    }),
    [theme, setTheme]
  );

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
