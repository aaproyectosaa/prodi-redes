// Las pantallas de Prodi Software vinieron de MP Socios (Next.js). Esto les da lo que usaban de Next (Link,
// router, parámetros) sobre react-router, y un fetch que va a /api/software con la sesión de Prodi.

import { forwardRef, useMemo, useRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { Link as RRLink, useLocation, useNavigate, useParams as useRRParams, useSearchParams as useRRSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { auth } from "@/integrations/firebase/client";

/** Rutas de MP Socios → rutas de Prodi Software. */
export function rutaSoftware(href: string): string {
  if (!href.startsWith("/")) return href;
  if (href.startsWith("/software")) return href;
  const [camino, query = ""] = href.split("?");
  const mapa: Record<string, string> = {
    "/": "/software",
    "/payments": "/software/pagos",
    "/clients": "/software/clientes",
    "/suscripciones": "/software/suscripciones",
    "/mantenimientos": "/software/mantenimientos",
    "/liquidacion": "/software/liquidacion",
    "/settlements": "/software/liquidacion",
    "/gastos": "/software/gastos",
    "/apps": "/software/apps",
    "/apps/new": "/software/apps/nueva",
    "/activity": "/software/actividad",
    "/socios": "/software/reparto",
    "/partners": "/software/reparto",
  };
  let destino = mapa[camino];
  if (!destino) {
    const app = camino.match(/^\/apps\/([^/]+)$/);
    destino = app ? `/software/apps/${app[1]}` : `/software${camino}`;
  }
  return query ? `${destino}?${query}` : destino;
}

export const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; children?: ReactNode }>(
  function Link({ href, prefetch, ...resto }, ref) {
    void prefetch;
    return <RRLink ref={ref} to={rutaSoftware(href)} {...resto} />;
  }
);
export default Link;

export function useRouter() {
  const navigate = useNavigate();
  const ir = useRef(navigate);
  ir.current = navigate;
  // Siempre el mismo objeto: varias pantallas lo tienen en las dependencias de sus efectos.
  return useMemo(
    () => ({
      push: (href: string) => ir.current(rutaSoftware(href)),
      replace: (href: string) => ir.current(rutaSoftware(href), { replace: true }),
      refresh: () => ir.current(0),
      back: () => ir.current(-1),
    }),
    []
  );
}

export function useSearchParams(): URLSearchParams {
  return useRRSearchParams()[0];
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useParams(): Record<string, string | undefined> {
  return useRRParams();
}

export function redirect(href: string): never {
  window.location.assign(rutaSoftware(href));
  throw new Error("redirect");
}

/** "/api/apps/123/sync?x=1" → "/api/software/app-sync?id=123&x=1" (mismas acciones que el despachador). */
export function apiSoftware(url: string): string {
  const [camino, query = ""] = url.split("?");
  const p = camino.replace(/^\/api\//, "").split("/").filter(Boolean);
  const extra = new URLSearchParams(query);
  let accion = p.join("-");
  if (p[0] === "apps" && p.length >= 2) {
    extra.set("id", decodeURIComponent(p[1]));
    if (p.length === 2) accion = "app";
    else if (p[2] === "clients" && p.length === 4) {
      accion = "app-client";
      extra.set("client", decodeURIComponent(p[3]));
    } else accion = `app-${p[2]}`;
  } else if (p[0] === "ingest" && p[1] === "mp-subscription" && p[2] === "visibility") accion = "ingest-mp-subscription-visibility";
  const qs = extra.toString();
  return `/api/software/${accion}${qs ? `?${qs}` : ""}`;
}

/** fetch de las pantallas de Software: a /api/software con el token de Prodi. */
export async function swFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url.startsWith("/api/") ? apiSoftware(url) : url, { ...init, headers });
}

/** Avisos de MP Socios → los de Prodi. Siempre la misma función (las pantallas la usan en efectos: si cambiara, se repetirían sin parar). */
const avisar = (msg: string) => {
  toast(msg, { id: msg });
};
export function useToast() {
  return avisar;
}
