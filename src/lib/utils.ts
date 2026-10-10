import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Un link de afuera que se puede abrir sin riesgo: solo http(s). Si no (ej. "javascript:"), no se abre. */
export function hrefSeguro(url: string | null | undefined): string | undefined {
  const u = String(url ?? "").trim();
  return /^https?:\/\//i.test(u) ? u : undefined;
}
