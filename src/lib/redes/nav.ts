import {
  Bell,
  CalendarDays,
  Gauge,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  Settings,
  TrendingUp,
  Users,
  Building2,
  MessageCircle,
  Video as VideoIcon,
  BarChart3,
  CreditCard,
  Receipt,
  Wallet,
  ClipboardList,
  HandCoins,
  Landmark,
  Store,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import type { UserRole } from "@/integrations/firebase/types";

export interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  /** Mostrar en la barra inferior del celular. */
  mobile?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export function navForRole(role: UserRole | undefined): NavSection[] {
  switch (role) {
    case "admin":
      // El tablero del dueño es el del negocio: plata, clientes y equipo. Producción queda aparte.
      return [
        {
          items: [
            { label: "Tablero", icon: Gauge, path: "/tablero", mobile: true },
            { label: "Clientes", icon: Building2, path: "/clientes", mobile: true },
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
            { label: "Mi asistente", icon: Sparkles, path: "/mi-asistente" },
          ],
        },
        {
          title: "Administración",
          items: [
            { label: "Resumen", icon: ClipboardList, path: "/administracion", mobile: true },
            { label: "Cobros", icon: Receipt, path: "/cobros" },
            { label: "Pagos al equipo", icon: HandCoins, path: "/pagos-equipo" },
            { label: "Gastos", icon: Wallet, path: "/gastos" },
            { label: "Deudas e impuestos", icon: Landmark, path: "/deudas" },
          ],
        },
        {
          title: "Producción",
          items: [
            { label: "Videos", icon: LayoutGrid, path: "/videos" },
            { label: "Rodajes", icon: CalendarDays, path: "/rodajes" },
            { label: "Piezas gráficas", icon: ImageIcon, path: "/piezas" },
            { label: "Reuniones", icon: VideoIcon, path: "/reuniones" },
          ],
        },
        {
          title: "Gestión",
          items: [
            { label: "Equipo", icon: Users, path: "/equipo" },
            { label: "Reportes", icon: BarChart3, path: "/reportes" },
            { label: "Ajustes", icon: Settings, path: "/ajustes" },
          ],
        },
      ];
    case "productor":
      return [
        {
          items: [
            { label: "Mis videos", icon: LayoutGrid, path: "/videos", mobile: true },
            { label: "Rodajes", icon: CalendarDays, path: "/rodajes", mobile: true },
            { label: "Piezas gráficas", icon: ImageIcon, path: "/piezas" },
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
            { label: "Clientes", icon: Building2, path: "/clientes", mobile: true },
            { label: "Reuniones", icon: VideoIcon, path: "/reuniones" },
            { label: "Mis ganancias", icon: HandCoins, path: "/mis-ganancias" },
          ],
        },
      ];
    case "administracion":
      return [
        {
          items: [
            { label: "Resumen", icon: ClipboardList, path: "/administracion", mobile: true },
            { label: "Cobros", icon: Receipt, path: "/cobros", mobile: true },
            { label: "Pagos al equipo", icon: HandCoins, path: "/pagos-equipo" },
            { label: "Gastos", icon: Wallet, path: "/gastos", mobile: true },
            { label: "Deudas e impuestos", icon: Landmark, path: "/deudas", mobile: true },
            { label: "Números", icon: Gauge, path: "/tablero" },
            { label: "Chat", icon: MessageCircle, path: "/chat" },
          ],
        },
      ];
    case "diseno":
      return [
        {
          items: [
            { label: "Piezas gráficas", icon: ImageIcon, path: "/piezas", mobile: true },
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
            { label: "Reuniones", icon: VideoIcon, path: "/reuniones", mobile: true },
            { label: "Mis ganancias", icon: HandCoins, path: "/mis-ganancias" },
          ],
        },
      ];
    case "editor":
    case "pauta":
      return [
        {
          items: [
            { label: "Mis videos", icon: LayoutGrid, path: "/videos", mobile: true },
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
            { label: "Reuniones", icon: VideoIcon, path: "/reuniones", mobile: true },
            { label: "Mis ganancias", icon: HandCoins, path: "/mis-ganancias" },
          ],
        },
      ];
    case "cliente":
      return [
        {
          items: [
            { label: "Mis videos", icon: Home, path: "/cliente", mobile: true },
            { label: "Resultados", icon: TrendingUp, path: "/cliente?tab=resultados", mobile: true },
            { label: "Piezas gráficas", icon: ImageIcon, path: "/cliente?tab=piezas", mobile: true },
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
            { label: "Material", icon: FolderOpen, path: "/cliente?tab=material" },
            { label: "Mi plan", icon: CreditCard, path: "/cliente?tab=plan" },
            { label: "Mi negocio", icon: Store, path: "/cliente?tab=negocio" },
          ],
        },
      ];
    default:
      return [];
  }
}

export const NOTIFICATIONS_ITEM: NavItem = {
  label: "Avisos",
  icon: Bell,
  path: "/notificaciones",
  mobile: true,
};
