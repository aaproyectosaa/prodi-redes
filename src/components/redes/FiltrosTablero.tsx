import { useState } from "react";
import { ArrowDownWideNarrow, Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Project } from "@/integrations/firebase/types";

// Filtros del tablero de edición y del de diseño (mismo circuito, mismos filtros):
// por empresa (cliente) y el orden de las tarjetas. Se recuerdan por pantalla en este navegador.

export type OrdenTablero = "urgente" | "llegada";

function useRecordado<T extends string>(key: string, inicial: T, validos: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const g = localStorage.getItem(key) as T | null;
      return g && validos.includes(g) ? g : inicial;
    } catch {
      return inicial;
    }
  });
  const cambiar = (n: T) => {
    setV(n);
    try {
      localStorage.setItem(key, n);
    } catch {
      /* sin almacenamiento: queda solo en esta sesión */
    }
  };
  return [v, cambiar];
}

export function useFiltrosTablero(clave: string) {
  const [cliente, setCliente] = useState("todos");
  const [orden, setOrden] = useRecordado<OrdenTablero>(`prodi-orden-${clave}`, "urgente", ["urgente", "llegada"]);
  return { cliente, setCliente, orden, setOrden };
}

/** Para ordenar por fecha: la más próxima primero; sin fecha, al final. */
export const porFecha = (a?: string | null, b?: string | null) => (a || "9999").localeCompare(b || "9999");

export function FiltrosTablero({
  clientes,
  cliente,
  setCliente,
  orden,
  setOrden,
  conOrden = true,
}: ReturnType<typeof useFiltrosTablero> & { clientes: Project[]; conOrden?: boolean }) {
  return (
    <>
      {clientes.length > 1 && (
        <Select value={cliente} onValueChange={setCliente}>
          <SelectTrigger className="h-10 w-full min-w-0 gap-1 rounded-xl bg-card px-3 text-[13px] sm:w-52 sm:text-sm [&>span]:truncate" aria-label="Empresa">
            <Building2 className="h-4 w-4 shrink-0 text-primary" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas las empresas</SelectItem>
            {[...clientes]
              .sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? ""))
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )}
      {conOrden && (
        <Select value={orden} onValueChange={(v) => setOrden(v as OrdenTablero)}>
          <SelectTrigger className="h-10 w-full min-w-0 gap-1 rounded-xl bg-card px-3 text-[13px] sm:w-52 sm:text-sm [&>span]:truncate" aria-label="Orden">
            <ArrowDownWideNarrow className="h-4 w-4 shrink-0 text-primary" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="urgente">Más urgente primero</SelectItem>
            <SelectItem value="llegada">Por orden de llegada</SelectItem>
          </SelectContent>
        </Select>
      )}
    </>
  );
}
