import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Project } from "@/integrations/firebase/types";

/** Miniatura del logo en Drive (los de ejemplo no tienen). */
const logoUrl = (fileId: string) =>
  fileId.startsWith("demo/") || fileId.startsWith("blob:") ? undefined : `https://drive.google.com/thumbnail?id=${fileId}&sz=w128`;

/** Logo del cliente (el que se carga en su marca) o, si no hay o no carga, sus iniciales con su color. */
export function LogoCliente({ cliente, className }: { cliente: Pick<Project, "nombre" | "color" | "marca_archivos">; className?: string }) {
  const id = cliente.marca_archivos?.logo?.drive_file_id;
  const src = id ? logoUrl(id) : undefined;
  const [fallo, setFallo] = useState(false);
  if (src && !fallo) {
    return (
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white", className)}>
        <img src={src} alt={cliente.nombre} loading="lazy" referrerPolicy="no-referrer" onError={() => setFallo(true)} className="h-full w-full object-contain p-0.5" />
      </span>
    );
  }
  return (
    <span
      className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white", className)}
      style={{ backgroundColor: cliente.color || "#6F40FC" }}
    >
      {cliente.nombre.slice(0, 2).toUpperCase()}
    </span>
  );
}
