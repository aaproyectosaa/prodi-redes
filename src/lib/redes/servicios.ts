import { AppWindow, Globe, LayoutDashboard, Wrench, type LucideIcon } from "lucide-react";

// Lo que el cliente contrató además de Redes (que todos tienen: videos, piezas y pauta). Cada servicio suma un
// módulo a su panel ("Mis servicios"): en qué estado está, el link para entrar y un botón para pedir cambios o ayuda.
// Se elige al dar de alta el cliente y se edita en su ficha (Configuración).

export type IdServicio = "web" | "erp" | "app" | "mantenimiento";
export type EstadoServicio = "desarrollo" | "activo";

export interface ServicioCliente {
  id: IdServicio;
  estado: EstadoServicio;
  /** Dónde entra el cliente (su web, su sistema). */
  url?: string | null;
  /** Lo que ve el cliente debajo (ej. "Entrás con tu mail; la clave te la pasamos por WhatsApp"). */
  detalle?: string | null;
  desde?: string | null;
}

export const SERVICIOS: { id: IdServicio; nombre: string; texto: string; icon: LucideIcon; color: string; abrir: string }[] = [
  { id: "web", nombre: "Página web", texto: "Tu web o tienda online", icon: Globe, color: "from-sky-500 to-blue-600", abrir: "Ver mi web" },
  { id: "erp", nombre: "Sistema ERP", texto: "Facturación, stock, cuentas corrientes, cheques e impuestos", icon: LayoutDashboard, color: "from-emerald-500 to-teal-600", abrir: "Entrar al sistema" },
  { id: "app", nombre: "App a medida", texto: "Tu plataforma o app hecha a medida", icon: AppWindow, color: "from-violet-500 to-fuchsia-500", abrir: "Abrir la app" },
  { id: "mantenimiento", nombre: "Mantenimiento", texto: "Soporte y cambios de tu sistema todos los meses", icon: Wrench, color: "from-amber-400 to-orange-500", abrir: "Abrir" },
];

export const servicioInfo = (id: IdServicio) => SERVICIOS.find((s) => s.id === id)!;

export const ESTADO_SERVICIO: Record<EstadoServicio, { label: string; clase: string }> = {
  desarrollo: { label: "En desarrollo", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  activo: { label: "Activo", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

/** Los servicios válidos de un cliente (en el orden del catálogo). */
export function serviciosDe(cliente: { servicios?: ServicioCliente[] | null } | null | undefined): ServicioCliente[] {
  const lista = Array.isArray(cliente?.servicios) ? cliente!.servicios! : [];
  return SERVICIOS.map((s) => lista.find((x) => x?.id === s.id)).filter((x): x is ServicioCliente => !!x);
}

/** Para el menú del cliente: qué servicios tiene en alguna de sus empresas. */
export function serviciosEnMenu(clientes: { servicios?: ServicioCliente[] | null }[]): IdServicio[] {
  const ids = new Set(clientes.flatMap((c) => serviciosDe(c).map((s) => s.id)));
  return SERVICIOS.filter((s) => ids.has(s.id)).map((s) => s.id);
}

/** "web.com" → "https://web.com" (para el botón de entrar). */
export const urlCompleta = (u: string) => (/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);
