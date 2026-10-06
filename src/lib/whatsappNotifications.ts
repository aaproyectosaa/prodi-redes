import type { Profile, UserRole } from "@/integrations/firebase/types";

/**
 * Tipos de aviso por WhatsApp. En Prodi Redes hay uno solo: los avisos del
 * circuito del video (los arma el servidor en /api/avisos con el texto listo).
 */
export type WhatsAppNotificationType = "prodi_aviso";

export interface WhatsAppNotificationDefinition {
  key: WhatsAppNotificationType;
  label: string;
  description: string;
  /** Roles que pueden suscribirse a este aviso. */
  recipientRoles: UserRole[];
}

export const WHATSAPP_NOTIFICATIONS: WhatsAppNotificationDefinition[] = [
  {
    key: "prodi_aviso",
    label: "Avisos del circuito",
    description:
      "Cuando te toca hacer algo: video para editar, para revisar, para aprobar, para pautar, rodaje agendado o pieza lista.",
    recipientRoles: ["admin", "productor", "editor", "pauta", "cliente"],
  },
];

export const WHATSAPP_TIMEZONE = "America/Argentina/Buenos_Aires";
export const WHATSAPP_SCHEDULE_START = 7;
export const WHATSAPP_SCHEDULE_END = 21;
/** Horas por defecto antes del recordatorio al CM. */
export const DEFAULT_CM_PUBLISH_REMINDER_HOURS = 24;
export const MIN_CM_PUBLISH_REMINDER_HOURS = 1;
export const MAX_CM_PUBLISH_REMINDER_HOURS = 168;

export const APP_SETTINGS_WHATSAPP_DOC = ["app_settings", "whatsapp_bot"] as const;

export interface WhatsAppBotSettings {
  bot_enabled: boolean;
  schedule_start_hour: number;
  schedule_end_hour: number;
  timezone: string;
  /** URL base de la app para links en WhatsApp (ej. https://tudominio.com). */
  app_base_url?: string;
  /** Si es manual, no se pisa con la URL detectada al abrir la app. */
  app_base_url_manual?: boolean;
  /**
   * Horas desde que la tarea pasa a «Para Publicar» hasta el recordatorio al CM.
   * Default 24. Rango 1–168.
   */
  cm_publish_reminder_hours?: number;
  /** Interruptor global por tipo de aviso. */
  global_types: Partial<Record<WhatsAppNotificationType, boolean>>;
  /** Valores por defecto cuando el usuario no personalizó. */
  role_defaults: Partial<
    Record<UserRole, Partial<Record<WhatsAppNotificationType, boolean>>>
  >;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export const isLocalAppOrigin = (origin: string): boolean => {
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/** Origen actual del navegador o VITE_APP_URL si está definida. */
export const resolveClientAppOrigin = (): string => {
  const fromEnv = import.meta.env.VITE_APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return "";
};

const ALL_TYPES = WHATSAPP_NOTIFICATIONS.map((n) => n.key);

const defaultGlobalTypes = (): Record<WhatsAppNotificationType, boolean> =>
  Object.fromEntries(ALL_TYPES.map((k) => [k, true])) as Record<
    WhatsAppNotificationType,
    boolean
  >;

const defaultRoleDefaults = (): WhatsAppBotSettings["role_defaults"] => ({
  admin: { prodi_aviso: true },
  productor: { prodi_aviso: true },
  editor: { prodi_aviso: true },
  pauta: { prodi_aviso: true },
  cliente: { prodi_aviso: true },
});

export const DEFAULT_WHATSAPP_BOT_SETTINGS: WhatsAppBotSettings = {
  bot_enabled: false,
  schedule_start_hour: WHATSAPP_SCHEDULE_START,
  schedule_end_hour: WHATSAPP_SCHEDULE_END,
  timezone: WHATSAPP_TIMEZONE,
  cm_publish_reminder_hours: DEFAULT_CM_PUBLISH_REMINDER_HOURS,
  global_types: defaultGlobalTypes(),
  role_defaults: defaultRoleDefaults(),
};

export function clampCmPublishReminderHours(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CM_PUBLISH_REMINDER_HOURS;
  return Math.min(
    MAX_CM_PUBLISH_REMINDER_HOURS,
    Math.max(MIN_CM_PUBLISH_REMINDER_HOURS, Math.round(n))
  );
}

export const mergeWhatsAppBotSettings = (
  partial?: Partial<WhatsAppBotSettings> | null
): WhatsAppBotSettings => {
  const mergedRoles: WhatsAppBotSettings["role_defaults"] = {
    ...DEFAULT_WHATSAPP_BOT_SETTINGS.role_defaults,
  };
  for (const [role, prefs] of Object.entries(partial?.role_defaults ?? {})) {
    const key = role as UserRole;
    mergedRoles[key] = {
      ...(DEFAULT_WHATSAPP_BOT_SETTINGS.role_defaults[key] ?? {}),
      ...prefs,
    };
  }
  return {
    ...DEFAULT_WHATSAPP_BOT_SETTINGS,
    ...partial,
    cm_publish_reminder_hours: clampCmPublishReminderHours(
      partial?.cm_publish_reminder_hours ??
        DEFAULT_WHATSAPP_BOT_SETTINGS.cm_publish_reminder_hours
    ),
    global_types: {
      ...DEFAULT_WHATSAPP_BOT_SETTINGS.global_types,
      ...(partial?.global_types ?? {}),
    },
    role_defaults: mergedRoles,
  };
};

export const getNotificationsForRole = (
  role: UserRole | undefined
): WhatsAppNotificationDefinition[] => {
  if (!role) return [];
  return WHATSAPP_NOTIFICATIONS.filter((n) => n.recipientRoles.includes(role));
};

export const isNotificationGloballyEnabled = (
  type: WhatsAppNotificationType,
  settings: WhatsAppBotSettings
): boolean => settings.global_types[type] !== false;

export const getRoleDefaultForNotification = (
  role: UserRole | undefined,
  type: WhatsAppNotificationType,
  settings: WhatsAppBotSettings
): boolean => {
  if (!role) return false;
  const rolePrefs = settings.role_defaults[role];
  if (rolePrefs && type in rolePrefs) {
    return rolePrefs[type] !== false;
  }
  return true;
};

/** Solo admin (defaults por rol + global). El usuario no personaliza tipos en perfil. */
export const getUserNotificationPreference = (
  profile: Pick<Profile, "role">,
  type: WhatsAppNotificationType,
  settings: WhatsAppBotSettings
): boolean => {
  const role = profile.role ?? "pending";
  if (!isNotificationGloballyEnabled(type, settings)) return false;
  return getRoleDefaultForNotification(role, type, settings);
};

/** Normaliza teléfono argentino a formato E.164 simple (+54911...). */
export const normalizeWhatsAppPhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("54")) return `+${digits}`;
  if (digits.startsWith("0")) return `+54${digits.slice(1)}`;
  if (digits.length >= 10) return `+54${digits}`;
  return `+${digits}`;
};

export const formatWhatsAppPhoneDisplay = (phone: string): string => {
  if (!phone) return "";
  return phone.startsWith("+") ? phone : `+${phone}`;
};

export const isValidWhatsAppPhone = (phone: string): boolean => {
  const normalized = normalizeWhatsAppPhone(phone);
  return /^\+54\d{10,11}$/.test(normalized);
};
