// Firestore types

/**
 * Roles del sistema. El rol determina qué acciones puede ejecutar un usuario
 * y qué vistas ve por defecto. Ver `src/lib/roles.ts` para la matriz de
 * permisos asociada a cada rol.
 *
 * `pending` es el estado inicial de un usuario recién registrado: no tiene
 * acceso a la aplicación hasta que un administrador le asigne un rol real.
 */
export type UserRole =
  | "pending"
  | "admin" // Super admin (dueño)
  | "productor" // Producción: clientes, planificación, rodajes y revisión interna
  | "editor" // Edición de video
  | "pauta" // Sube los videos y maneja la pauta en Meta
  | "diseno" // Diseño gráfico: arma las piezas de sus clientes (y de los que no tienen diseñadora), con IA de apoyo
  | "administracion" // Administración: facturación, cobros, pagos al equipo y gastos
  | "cliente"
  | "contacto" // Contacto de un cliente que usa solo Prodi Chat (proyecto_id = su cliente)
  // Roles del modelo anterior. Se leen para no romper datos viejos, pero ya
  // no se asignan: un usuario con alguno de estos queda "pendiente" hasta que
  // el admin le asigne un rol nuevo.
  | "cm"
  | "pm"
  | "disenador";

export interface Profile {
  id: string;
  nombre: string;
  email: string;
  profileImage?: string;
  avatarColor?: string;
  theme?: "light" | "dark";
  project_permissions?: string[]; // IDs de proyectos que el usuario puede ver
  dashboard_access?: boolean; // Si tiene acceso al dashboard administrativo
  role?: UserRole; // Rol del usuario (si no está definido se asume "editor")
  /** Paneles de inicio adicionales (ej. admin que también trabaja como editor o productor). */
  extra_panel_roles?: UserRole[];
  /** Enlace "Mis tareas" en el menú lateral (editor/diseñador/productor). Por defecto visible. */
  show_mis_tareas_in_nav?: boolean;
  /** @deprecated Usar show_mis_tareas_in_nav. Se mantiene solo por compatibilidad al leer. */
  show_mis_tareas_on_home?: boolean;
  /** Acceso a /tareas (lista completa, crear, exportar). Por defecto según rol (admin/cm/pm). */
  task_list_access?: boolean;
  /** Acceso a /projects en el menú lateral. Por defecto según rol (admin/cm/pm). */
  projects_access?: boolean;
  /** Avisos por correo (todo lo que llega a la app). Default: sí (solo false los apaga). */
  email_avisos?: boolean;
  /** Si el usuario activó avisos push en el navegador / PWA (Android e iOS). */
  push_enabled?: boolean;
  /** Tokens FCM Web Push (varios dispositivos). */
  fcm_tokens?: string[];
  /** Tamaño de fuente en título y descripción del panel de tareas. */
  task_detail_font_sizes?: {
    titulo?: "xs" | "sm" | "md" | "lg";
    descripcion?: "xs" | "sm" | "md" | "lg";
  };
  created_at?: string;
  /** Última vez que abrió el sistema. */
  ultimo_acceso?: string;
  /** false = desactivado por el admin (no puede entrar). */
  activo?: boolean;
  /** Cuándo el cliente vio (o cerró) la guía de bienvenida. */
  guia_cliente_at?: string | null;
  /** Contacto (solo chat): el cliente al que pertenece, cargo y teléfono. */
  proyecto_id?: string | null;
  cargo?: string | null;
  telefono?: string | null;
}

/** Roles operativos asignables por proyecto (distintos del rol global del perfil). */
export type ProjectTeamRole =
  | "productor"
  | "editor"
  | "pauta"
  | "diseno" // Diseño gráfico: si el cliente no tiene ninguna, lo ven todas las de diseño
  | "cliente"
  // Heredados del modelo anterior (solo lectura).
  | "pm"
  | "cm"
  | "disenador";

/** Mapa rol → IDs de usuario asignados al proyecto. Un usuario puede aparecer en varios roles. */
export type ProjectTeamRoles = Record<ProjectTeamRole, string[]>;

/** Quién revisa las entregas en «Producido sin Aprobar» para este proyecto. */
export type ProjectReviewFlow = "pm" | "cliente";

export type TipoContenido =
  | "Feed"
  | "Feed Carrusel"
  | "Historia"
  | "Historia Audiovisual"
  | "Reel";
export type EstadoTarea =
  | "Sin Iniciar"
  | "En Producción"
  | "Producido sin Aprobar"
  | "Para Publicar"
  | "Publicado"
  | "Programado";

/** Límite numérico o ilimitado (`null`). */
export type ContentLimitValue = number | null;

export type ContentPlanLimits = Partial<Record<TipoContenido, ContentLimitValue>>;

/** Catálogo de planes mensuales (colección `content_plans`). */
export interface ContentPlan {
  id: string;
  nombre: string;
  precio_mensual_neto: number;
  activo: boolean;
  orden: number;
  /** Por tipo. `null` = ilimitado. Feed suele ser siempre ilimitado. */
  limits: ContentPlanLimits;
  created_at?: string;
  updated_at?: string;
}

/** Overrides opcionales sobre el plan base (precio / límites). */
export interface ProjectPlanOverrides {
  precio_mensual_neto?: number;
  limits?: ContentPlanLimits;
}

/** Módulos visibles en el portal del cliente para este proyecto. */
export interface ClientPortalModules {
  approve: boolean;
  calendar: boolean;
  history: boolean;
  plan: boolean;
  /** Tab Nuevo pedido / catálogo de servicios. */
  extrasRequest: boolean;
}

export interface ClientPortalConfig {
  modules: ClientPortalModules;
  show_prices?: boolean;
  /** boleta | factura — para IVA en fase 2. */
  comprobante?: "boleta" | "factura";
}

/** Condición del cliente frente al IVA (la pide ARCA y define la letra de la factura). */
export type CondicionIva = "responsable_inscripto" | "monotributo" | "exento" | "consumidor_final";
export const CONDICIONES_IVA: Record<CondicionIva, string> = {
  responsable_inscripto: "Responsable inscripto",
  monotributo: "Monotributista",
  exento: "Exento",
  consumidor_final: "Consumidor final",
};

/** Una versión del logo con su nombre ("Blanco, para fondos oscuros"). */
export type LogoVariante = DriveAttachmentRef & { etiqueta: string };

export interface Project {
  id: string;
  nombre: string;
  color: string;
  /**
   * Si es `false`, el proyecto y sus tareas no aparecen en el sistema
   * (listas, homes, dashboard, selectores, notificaciones).
   * No borra datos. Si falta el campo, se considera habilitado.
   */
  enabled?: boolean;
  monthly_limits?: {
    [key in TipoContenido]?: number;
  };
  /** Plan de contenido asignado (`content_plans` id). */
  plan_id?: string | null;
  /** Ajustes sobre el plan (casos “BASE ajustado”, etc.). */
  plan_overrides?: ProjectPlanOverrides;
  /** Qué ve el usuario cliente en su portal para este proyecto. */
  client_portal?: ClientPortalConfig;
  /** Miembros del equipo por rol operativo en este proyecto. */
  team_roles?: Partial<ProjectTeamRoles>;
  /**
   * Flujo de revisión de entregas.
   * - `pm` (default): el PM califica y aprueba.
   * - `cliente`: el cliente aprueba o pide cambios (sin rúbrica del PM).
   */
  review_flow?: ProjectReviewFlow;
  /**
   * Tipos que el cliente debe aprobar cuando `review_flow === "cliente"`.
   * Si falta, se asume que todos están activos.
   */
  client_review_content_types?: Partial<Record<TipoContenido, boolean>>;
  created_at?: string;

  // ---------------- Prodi Redes (modelo videos + pauta) ----------------
  /** Plan de videos (`planes_redes` id). */
  plan_redes_id?: string | null;
  /** Ajustes puntuales sobre el plan para este cliente. */
  plan_redes_override?: {
    videos_mes?: number | null;
    piezas_mes?: number | null;
    precio_mensual?: number | null;
    precio_video_extra?: number | null;
  } | null;
  /** Cómo se le factura el día 27 (lo maneja el super admin). */
  facturacion?: {
    /** factura = con IVA, se autoriza en ARCA (es la opción por defecto); boleta = sin IVA, no va a ARCA. */
    tipo?: "boleta" | "factura";
    razon_social?: string | null;
    cuit?: string | null;
    /** Condición frente al IVA (para la factura de ARCA: define si va A o B). */
    condicion_iva?: CondicionIva | null;
    /** Ítems que se suman todos los meses (ej. "Combustible"). */
    extras_fijos?: { concepto: string; neto: number }[];
    /** "Tiene pagado hasta": último mes de servicio pagado por adelantado (YYYY-MM); hasta esa boleta sale cobrada. */
    adelantado_hasta?: string | null;
    /** Días del mes siguiente al facturado en que paga (por defecto del 1 al 5). Vence el último. */
    pago_desde?: number | null;
    pago_hasta?: number | null;
    /** No se le prepara la boleta sola el 27 (canje, pausa): se le factura solo eligiéndolo a mano. */
    pausada?: boolean;
    /** No mandarle recordatorios automáticos de pago. */
    sin_recordatorios?: boolean;
  } | null;
  /** Videos extra comprados por mes: { "2026-10": 2 }. */
  creditos_extra?: Record<string, number>;
  /** Correos que reciben el informe mensual. */
  contacto_emails?: string[];
  /** Contexto de marca para la IA (copys y piezas). */
  marca?: {
    rubro?: string;
    publico?: string;
    tono?: string;
    colores?: string;
    /** Colores de la marca en hex, el primero es el principal. */
    paleta?: string[];
    /** Nombre y uso de cada color de la paleta (por hex en minúscula): "Verde Maurenzi · fondos". */
    colores_info?: Record<string, { nombre?: string; uso?: string }>;
    /** Tipografías de la marca ("Títulos: Amatic SC · Textos: Montserrat"). */
    tipografias?: string;
    /** Reglas de uso de la marca (qué logo sobre qué fondo, qué no hacer). */
    notas?: string;
    /** Qué hace distinto al negocio, en palabras del cliente. */
    descripcion?: string;
  } | null;
  /** Logo y piezas de referencia para la IA (los escribe el servidor). */
  marca_archivos?: {
    /** Logo principal (el que se ve en Clientes y la IA pone en las piezas). */
    logo?: DriveAttachmentRef;
    /** Foto de perfil armada con el logo (centrado, sin márgenes, JPEG chico); `de` = el logo del que salió. */
    avatar?: { img: string; de: string };
    /** Otras versiones del logo: blanco, negro, horizontal, isotipo, marca de agua… */
    variantes?: LogoVariante[];
    /** Manual de marca, brandboard, guías (PDF o imagen). */
    manuales?: DriveAttachmentRef[];
    referencias?: DriveAttachmentRef[];
  } | null;
  /** Débito automático del abono mensual (Mercado Pago, lo escribe el servidor). */
  suscripcion?: {
    mp_preapproval_id: string;
    estado: "pendiente" | "activa" | "pausada" | "cancelada";
    /** Lo que debita por mes (total de la boleta + comisión de Mercado Pago). */
    monto: number;
    /** Comisión de MP (%) que ya va sumada en `monto`. Las suscripciones viejas no la tienen. */
    comision_pct?: number | null;
    payer_email: string;
    init_point?: string | null;
    creada_at: string;
    actualizada_at?: string;
    ultimo_pago_at?: string | null;
  } | null;
  /** Usuarios de redes del cliente. */
  redes?: {
    instagram?: string;
    facebook?: string;
    tiktok?: string;
  } | null;
  /**
   * Conexión con Meta (a futuro): publicar y pautar desde el sistema.
   * Hoy solo se guardan los IDs; ver docs/META.md.
   */
  meta?: {
    page_id?: string;
    ig_user_id?: string;
    ad_account_id?: string;
    conectado?: boolean;
  } | null;
  /** Fecha de alta del cliente (YYYY-MM-DD). */
  alta?: string | null;
  /** Producción de los videos. `filma`: quién filma (por defecto Prodi). */
  produccion?: { filma?: QuienFilma } | null;
}

/** prodi = filmamos nosotros · cliente = filma él y nos manda el material · ambos = se elige en cada video. */
export type QuienFilma = "prodi" | "cliente" | "ambos";

/** Cómo el cliente elige el ítem en Nuevo pedido. */
export type PortalServiceSelection = "counter" | "toggle" | "request";

/** Ítem dentro de una categoría del catálogo de servicios. */
export interface PortalServiceItem {
  id: string;
  nombre: string;
  /** Texto corto bajo el nombre. */
  descripcion?: string;
  /** Detalle para el diálogo “ver más”. */
  detalle?: string;
  /** `null` = lo cotiza el equipo. */
  precio_unitario: number | null;
  selection: PortalServiceSelection;
  min?: number;
  max?: number;
  orden: number;
  activo: boolean;
}

/** Categoría del catálogo (colección `portal_service_categories`). */
export interface PortalServiceCategory {
  id: string;
  nombre: string;
  descripcion: string;
  /** Emoji preferido para la UI (ver `portalServiceIcons`). */
  emoji?: string;
  /** Icono Lucide si no hay emoji. */
  icon?: string;
  orden: number;
  activo: boolean;
  items: PortalServiceItem[];
  created_at?: string;
  updated_at?: string;
}

export type PortalServiceRequestStatus =
  | "solicitado"
  | "en_revision"
  | "cotizado"
  | "cancelado";

/** Pedido de servicios del cliente (colección `portal_service_requests`). */
export interface PortalServiceRequestLine {
  item_id: string;
  nombre: string;
  quantity: number;
  precio_unitario: number | null;
  subtotal: number | null;
}

export interface PortalServiceRequest {
  id: string;
  proyecto_id: string;
  proyecto_nombre?: string;
  category_id: string;
  category_nombre: string;
  lines: PortalServiceRequestLine[];
  /** null si hay ítems sin precio fijo. */
  total: number | null;
  notas?: string | null;
  fecha_deseada?: string | null;
  estado: PortalServiceRequestStatus;
  created_by: string;
  created_at: string;
}

export interface EditHistoryEntry {
  edited_by: string;
  edited_at: string;
  field?: string; // Campo editado (opcional)
}

export interface Task {
  id: string;
  titulo: string;
  descripcion: string | null;
  notas: string | null; // Notas adicionales para tareas audiovisuales
  feedback_pm: string | null; // Nota del PM al rechazar contenido para corrección
  /** Nota del cliente al pedir cambios (flujo review_flow = cliente). */
  feedback_cliente: string | null;
  /** Audios / imágenes / videos del pedido de cambios (en orden de envío). */
  feedback_cliente_attachments?: ClientFeedbackAttachment[];
  /** Última calificación del cliente (1–5) al aprobar o pedir cambios. */
  client_rating?: number | null;
  client_rating_comment?: string | null;
  client_reviewed_at?: string | null;
  client_reviewed_by?: string | null;
  material_crudo: string | null; // Material sin editar (fotos, videos crudos)
  material_finalizado: string | null;
  attachments_crudo?: DriveAttachmentRef[]; // Archivos subidos a Drive (material crudo)
  attachments_finalizado?: DriveAttachmentRef[]; // Archivos subidos a Drive (material finalizado)
  fecha: string | null;
  proyecto_id: string | null;
  tipo: TipoContenido | null;
  estado: EstadoTarea | null;
  completed: boolean;
  responsible_user_ids: string[];
  last_edited_by: string | null;
  last_edited_at: string;
  edit_history?: EditHistoryEntry[]; // Historial de ediciones
  created_at?: string;
  /** Tarea principal: solicita material crudo al productor. */
  requires_raw_material?: boolean;
  /** ID de la tarea vinculada para el productor (solo en tarea principal). */
  raw_material_task_id?: string | null;
  /** Tarea derivada para que el productor entregue material antes del editor. */
  is_raw_material_task?: boolean;
  /** ID de la tarea principal (solo en tarea de material crudo). */
  parent_task_id?: string | null;
}

export interface DriveAttachmentRef {
  drive_file_id: string;
  name: string;
  mime_type: string;
  size: number;
  thumbnail_link?: string;
  web_view_link: string;
  web_content_link?: string;
  uploaded_at: string;
  uploaded_by: string;
  folder_path: string;
  /** Lo subió el cliente desde su panel (material que filmó él). */
  origen?: "cliente";
}

/** Adjunto del pedido de cambios del cliente (Google Drive). */
export type ClientFeedbackMediaKind = "audio" | "image" | "video";

export interface ClientFeedbackAttachment {
  id: string;
  kind: ClientFeedbackMediaKind;
  /** Orden de envío (0-based). */
  order: number;
  drive_file_id: string;
  name: string;
  mime_type: string;
  size: number;
  thumbnail_link?: string;
  web_view_link: string;
  web_content_link?: string;
  uploaded_at: string;
  uploaded_by: string;
  folder_path: string;
}
