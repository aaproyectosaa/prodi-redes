import { createContext, useContext, useState, ReactNode, useCallback } from "react";

interface SidebarExtrasContextType {
  extras: ReactNode | null;
  setExtras: (node: ReactNode | null) => void;
}

const SidebarExtrasContext = createContext<SidebarExtrasContextType>({
  extras: null,
  setExtras: () => {},
});

/**
 * Provider que permite a las páginas inyectar contenido extra en el sidebar
 * del AppLayout (ej: botones de crear tarea, filtros, buscador).
 */
export const SidebarExtrasProvider = ({ children }: { children: ReactNode }) => {
  const [extras, setExtras] = useState<ReactNode | null>(null);

  return (
    <SidebarExtrasContext.Provider value={{ extras, setExtras }}>
      {children}
    </SidebarExtrasContext.Provider>
  );
};

/**
 * Hook para que las páginas registren contenido extra en el sidebar.
 * Llamar setExtras(null) al desmontar para limpiar.
 */
export const useSidebarExtras = () => useContext(SidebarExtrasContext);
