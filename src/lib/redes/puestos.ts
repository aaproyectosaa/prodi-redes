import type { Project, PuestoCliente } from "@/integrations/firebase/types";

export const PUESTOS: { v: PuestoCliente; label: string }[] = [
  { v: "dueno", label: "Dueño" },
  { v: "gerente", label: "Gerente" },
  { v: "empleado", label: "Empleado" },
];

/** ¿Ve cuánto cuesta el servicio (abono, boletas, deuda)? El dueño y el gerente sí; el empleado no. Sin marcar: sí. */
export function vePrecios(cliente: Pick<Project, "puestos"> | null | undefined, uid: string | null | undefined): boolean {
  if (!cliente || !uid) return true;
  return cliente.puestos?.[uid] !== "empleado";
}
