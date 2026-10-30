import {
  Bell,
  CalendarDays,
  Gauge,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  Settings,
  Timer,
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
  ListTodo, Inbox, Globe, Megaphone, FileText, Contact, Trophy, BookOpen, Handshake, GraduationCap } from "lucide-react";
import { servicioInfo, type IdServicio } from "@/lib/redes/servicios";
import type { UserRole } from "@/integrations/firebase/types";
import { getRoleInfo } from "@/lib/roles";

export interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  /** Mostrar en la barra inferior del celular. */
  mobile?: boolean;
  /** Todavía no se puede usar: se ve con la etiqueta "Pronto". */
  pronto?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/** Menú de Prodi Software: dirección (admin y administración) todo; programación, lo suyo. */
export function navSoftware(roles: UserRole[]): NavSection[] {
  const direccion = roles.includes("admin") || roles.includes("administracion");
  if (direccion)
    return [
      {
        items: [
          { label: "Inicio", icon: Gauge, path: "/software", mobile: true },
          { label: "Cobros", icon: CreditCard, path: "/software/pagos", mobile: true },
          { label: "Clientes", icon: Store, path: "/software/clientes", mobile: true },
          { label: "Planes mensuales", icon: Receipt, path: "/software/suscripciones" },
          { label: "Mantenimiento", icon: ClipboardList, path: "/software/mantenimientos" },
          { label: "Tareas", icon: ListTodo, path: "/software/tareas" },
          { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
        ],
      },
      {
        title: "Administración",
        items: [
          { label: "Liquidación", icon: HandCoins, path: "/software/liquidacion" },
          { label: "Gastos", icon: Wallet, path: "/software/gastos" },
          { label: "Reparto (%)", icon: Users, path: "/software/reparto" },
          { label: "Apps de Mercado Pago", icon: Landmark, path: "/software/apps" },
          { label: "Actividad", icon: BarChart3, path: "/software/actividad" },
        ],
      },
    ];
  return [
    {
      items: [
        { label: "Tareas", icon: ListTodo, path: "/software/tareas", mobile: true },
        { label: "Clientes", icon: Store, path: "/software/clientes", mobile: true },
        { label: "Cobros", icon: CreditCard, path: "/software/pagos", mobile: true },
        { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
        { label: "Mis ganancias", icon: HandCoins, path: "/software/mis-ganancias", mobile: true },
      ],
    },
  ];
}

/** Menú del rol principal + un módulo por cada rol adicional (con su nombre, sin repetir lo que ya está). En Software, el suyo. */
export function navForRoles(role: UserRole | undefined, roles: UserRole[] = [], empresa: "redes" | "software" = "redes", opciones: OpcionesNav = {}): NavSection[] {
  if (empresa === "software") return navSoftware(roles.length ? roles : role ? [role] : []);
  const base = navForRole(role, opciones);
  const ya = new Set(base.flatMap((s) => s.items.map((i) => i.path)));
  const modulos: NavSection[] = [];
  for (const r of roles) {
    if (r === role) continue;
    const items: NavItem[] = [];
    for (const s of navForRole(r))
      for (const i of s.items)
        if (!ya.has(i.path)) {
          ya.add(i.path);
          // En el celular la barra de abajo queda la del rol principal.
          items.push({ ...i, mobile: false });
        }
    if (items.length) modulos.push({ title: getRoleInfo(r).label, items });
  }
  // Con más de un rol, lo del rol principal también va como módulo con su nombre (si no tenía título).
  const conNombre = modulos.length && role ? base.map((sec, i) => (i === 0 && !sec.title ? { ...sec, title: getRoleInfo(role).label } : sec)) : base;
  return [...conNombre, ...modulos];
}

export interface OpcionesNav {
  /** El CRM (beta) del cliente: prendido o en "Próximamente". */
  crm?: "activo" | "pronto" | null;
  /** Lo que contrató además de Redes (web, ERP…): cada uno es un ítem en «Mis servicios». */
  servicios?: IdServicio[];
}

export function navForRole(role: UserRole | undefined, opciones: OpcionesNav = {}): NavSection[] {
  switch (role) {
    case "admin":
      // El tablero del dueño es el del negocio: plata, clientes y equipo. Producción queda aparte.
      return [
        {
          title: "Inicio",
          items: [
            { label: "Tablero", icon: Gauge, path: "/tablero", mobile: true },
            { label: "Pedidos", icon: Inbox, path: "/pedidos" },
            { label: "Clientes", icon: Building2, path: "/clientes", mobile: true },
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
            { label: "Mi asistente", icon: Sparkles, path: "/mi-asistente" },
          ],
        },
        {
          // Ventas: los que todavía no son clientes (la web, los cargados a mano) y las propuestas.
          title: "CRM",
          items: [
            { label: "Leads", icon: Globe, path: "/web" },
            { label: "Presupuestos", icon: FileText, path: "/presupuestos" },
            { label: "Vendedores", icon: Handshake, path: "/socios" },
            { label: "Postulantes", icon: Contact, path: "/postulantes" },
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
            { label: "Pauta", icon: Megaphone, path: "/pauta" },
            { label: "Rodajes", icon: CalendarDays, path: "/rodajes" },
            { label: "Piezas gráficas", icon: ImageIcon, path: "/piezas" },
            { label: "Reuniones", icon: VideoIcon, path: "/reuniones" },
          ],
        },
        {
          title: "Gestión",
          items: [
            { label: "Equipo", icon: Users, path: "/equipo" },
            { label: "Academia", icon: GraduationCap, path: "/academia" },
            { label: "Reportes", icon: BarChart3, path: "/reportes" },
            { label: "Escalabilidad", icon: TrendingUp, path: "/escalabilidad" },
            { label: "Mi tiempo", icon: Timer, path: "/mi-tiempo" },
            { label: "Ajustes", icon: Settings, path: "/ajustes" },
          ],
        },
      ];
    case "productor":
      return [
        {
          items: [
            { label: "Mis videos", icon: LayoutGrid, path: "/videos", mobile: true },
            { label: "Pedidos", icon: Inbox, path: "/pedidos" },
            { label: "Rodajes", icon: CalendarDays, path: "/rodajes", mobile: true },
            { label: "Piezas gráficas", icon: ImageIcon, path: "/piezas" },
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
            { label: "Clientes", icon: Building2, path: "/clientes", mobile: true },
            { label: "Reuniones", icon: VideoIcon, path: "/reuniones" },
            { label: "Mis ganancias", icon: HandCoins, path: "/mis-ganancias" },
            { label: "Academia", icon: GraduationCap, path: "/academia" },
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
            { label: "Academia", icon: GraduationCap, path: "/academia" },
          ],
        },
      ];
    case "pauta":
      return [
        {
          items: [
            { label: "Mis videos", icon: LayoutGrid, path: "/videos", mobile: true },
            { label: "Pauta", icon: Megaphone, path: "/pauta", mobile: true },
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
            { label: "Reuniones", icon: VideoIcon, path: "/reuniones" },
            { label: "Mis ganancias", icon: HandCoins, path: "/mis-ganancias" },
            { label: "Academia", icon: GraduationCap, path: "/academia" },
          ],
        },
      ];
    case "editor":
      return [
        {
          items: [
            { label: "Mis videos", icon: LayoutGrid, path: "/videos", mobile: true },
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
            { label: "Reuniones", icon: VideoIcon, path: "/reuniones", mobile: true },
            { label: "Mis ganancias", icon: HandCoins, path: "/mis-ganancias" },
            { label: "Academia", icon: GraduationCap, path: "/academia" },
          ],
        },
      ];
    case "ventas":
      // Ventas: el CRM de Prodi (los que todavía no son clientes y las propuestas).
      return [
        {
          title: "CRM",
          items: [
            { label: "Leads", icon: Globe, path: "/web", mobile: true },
            { label: "Presupuestos", icon: FileText, path: "/presupuestos", mobile: true },
          ],
        },
      ];
    case "socio":
      // Socio comercial: sus empresarios, su link y lo que gana. Nada más del sistema.
      return [
        {
          items: [
            { label: "Mis clientes", icon: Handshake, path: "/socio", mobile: true },
            { label: "Mis ganancias", icon: HandCoins, path: "/mis-ganancias", mobile: true },
          ],
        },
      ];
    case "cliente":
      // Por módulo, como el menú del admin: sus redes, el CRM (si lo tiene prendido) y su cuenta.
      return [
        {
          title: "Redes",
          items: [
            { label: "Mis videos", icon: Home, path: "/cliente", mobile: true },
            { label: "Resultados", icon: TrendingUp, path: "/cliente?tab=resultados", mobile: true },
            { label: "Piezas gráficas", icon: ImageIcon, path: "/cliente?tab=piezas", mobile: true },
            { label: "Material", icon: FolderOpen, path: "/cliente?tab=material" },
          ],
        },
        ...(opciones.crm ? [
              {
                title: "CRM",
                items: [
                  { label: "Qué incluye", icon: BookOpen, path: "/cliente?tab=crm", pronto: opciones.crm === "pronto" },
                  { label: "Mis contactos", icon: Contact, path: "/cliente?tab=contactos", pronto: opciones.crm === "pronto" },
                  { label: "Qué te vende", icon: Trophy, path: "/cliente?tab=vende", pronto: opciones.crm === "pronto" },
                  { label: "Equipo", icon: Users, path: "/cliente?tab=equipo", pronto: opciones.crm === "pronto" },
                ],
              },
            ] : []),
        ...(opciones.servicios?.length
          ? [
              {
                title: "Mis servicios",
                items: opciones.servicios.map((id) => ({ label: servicioInfo(id).nombre, icon: servicioInfo(id).icon, path: `/cliente?tab=servicios&s=${id}` })),
              },
            ]
          : []),
        {
          title: "Mi cuenta",
          items: [
            { label: "Chat", icon: MessageCircle, path: "/chat", mobile: true },
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

/** Para el menú: el CRM de los clientes de la persona (alcanza con uno prendido; si no, alguno en "Próximamente"). */
export function estadoCrm(clientes: { crm_activo?: boolean; crm_proximamente?: boolean }[]): "activo" | "pronto" | null {
  return clientes.some((c) => c.crm_activo) ? "activo" : clientes.some((c) => c.crm_proximamente) ? "pronto" : null;
}
