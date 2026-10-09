import type { DriveAttachmentRef } from "@/integrations/firebase/types";

/**
 * Modelo de Prodi Redes: videos comerciales con pauta en Meta.
 *
 * Colecciones nuevas en Firestore:
 * - `videos`        → cada video comercial y su recorrido completo.
 * - `rodajes`       → jornadas de filmación (se filma todo el mismo día).
 * - `piezas_ia`     → piezas gráficas pedidas por el cliente, hechas con IA (extra pago).
 * - `cobros`        → pagos con Mercado Pago (piezas IA, videos extra).
 * - `planes_redes`  → catálogo de planes (cuántos videos por mes, precio).
 * - `informes`      → registro de informes mensuales enviados.
 * - `app_settings/redes` → configuración general (precio pieza IA, alertas).
 */

export type EtapaVideo =
  | "planificado" // Idea cargada con el cliente
  | "agendado" // Tiene rodaje con día, hora y lugar
  | "material_cliente" // Lo filma el cliente: esperando que suba el material
  | "edicion" // Material crudo cargado; lo edita la editora
  | "revision_interna" // Lo revisa la productora
  | "revision_cliente" // Lo aprueba el cliente
  | "para_publicar" // Aprobado: lo sube y pauta el equipo de pauta
  | "publicado"; // Subido y con pauta

export interface HistorialVideo {
  at: string;
  by: string;
  accion: string;
  nota?: string | null;
}

export interface PublicacionVideo {
  /** Lo sube el cliente: se le entregó el video aprobado (no lo publicamos nosotros). */
  sube_cliente?: boolean;
  publicado_at: string;
  link_instagram?: string | null;
  link_facebook?: string | null;
  link_tiktok?: string | null;
}

export interface PautaVideo {
  activa: boolean;
  objetivo?: string | null; // mensajes, ventas, alcance, tráfico…
  presupuesto?: number | null; // ARS total de la campaña
  inicio?: string | null; // YYYY-MM-DD
  fin?: string | null; // YYYY-MM-DD
  notas?: string | null;
}

export interface ResultadosVideo {
  alcance?: number | null;
  impresiones?: number | null;
  reproducciones?: number | null;
  interacciones?: number | null;
  mensajes?: number | null;
  clics?: number | null;
  gasto?: number | null; // ARS
  actualizado_at: string;
  actualizado_por: string;
}

/** Archivo ya cargado (de otro video del cliente) que el cliente eligió para un video nuevo. */
export interface ArchivoBase {
  drive_file_id: string;
  name: string;
  mime_type: string;
  size: number;
  web_view_link: string;
  thumbnail_link?: string;
  video_id: string;
  video_titulo: string;
}

/** De dónde sale el material de un video pedido por el cliente. */
export interface MaterialBase {
  tipo: "existente" | "nueva" | "cliente";
  archivos?: ArchivoBase[];
  /** Filmación nueva: cuándo le queda mejor filmar. */
  preferencia?: string | null;
}

export interface Video {
  id: string;
  /** Traído de un sistema anterior (progreso / postgo). */
  _origen?: string;
  /** Datos del sistema anterior: ahí el material crudo y el final eran links a carpetas de Drive. */
  _viejo?: { material_crudo?: string | null; material_finalizado?: string | null } | null;
  proyecto_id: string;
  titulo: string;
  /** Idea / guion acordado con el cliente. */
  idea: string | null;
  /** Para qué es el video (vender X, conseguir mensajes, mostrar el local…). */
  objetivo: string | null;
  /** Links de referencia (videos que le gustan al cliente, etc.). */
  referencias: string | null;
  /** Mes del plan al que pertenece (YYYY-MM). */
  mes: string;
  /** Si es un video extra comprado aparte (no descuenta del plan). */
  extra: boolean;
  etapa: EtapaVideo;
  /** Desde cuándo está en la etapa actual (para detectar trabados). */
  etapa_desde: string;
  /** Para cuándo tiene que estar editado (YYYY-MM-DD): lo pone producción al mandarlo a edición. */
  entrega_edicion?: string | null;
  /** Último recordatorio de entrega mandado ("manana" o "tarde"), para no repetirlo. */
  entrega_aviso?: string | null;
  rodaje_id: string | null;
  productor_id: string | null;
  editor_id: string | null;
  pauta_id: string | null;
  attachments_crudo: DriveAttachmentRef[];
  attachments_finalizado: DriveAttachmentRef[];
  /** Texto del posteo. */
  copy: string | null;
  feedback_interno: string | null;
  feedback_cliente: string | null;
  /** Cantidad de veces que volvió a edición. */
  rondas: number;
  cliente_rating?: number | null;
  publicacion: PublicacionVideo | null;
  pauta: PautaVideo | null;
  resultados: ResultadosVideo | null;
  /** IDs de Meta. Con `ad_id` (anuncio, conjunto o campaña) los resultados se traen solos. */
  meta?: { post_id?: string; ad_id?: string; campaign_id?: string } | null;
  /** Lo pidió el cliente desde su panel. */
  pedido_cliente?: boolean;
  /** Para cuándo lo quiere publicado el cliente (YYYY-MM-DD). */
  fecha_deseada?: string | null;
  /** Guion por escenas (lo arma la IA o producción). */
  guion?: string | null;
  /** Lista de tomas para el día de rodaje. */
  tomas?: string[];
  /** Correcciones marcadas en un segundo exacto del video (las ve edición en la línea de tiempo). */
  feedback_marcas?: MarcaCorreccion[] | null;
  /** Recordatorios automáticos al cliente para que apruebe (cada 48 h, máximo 3). */
  recordatorios_cliente?: number;
  recordatorio_cliente_at?: string | null;
  /** Salió de una idea del plan del mes. */
  plan_idea_id?: string | null;
  /** Lo filma el cliente y nos manda el material (no lleva rodaje). */
  filma_cliente?: boolean;
  /** Con qué material lo pidió el cliente (lo escribe el servidor; igual que api/_lib/pedidos.ts). */
  material_base?: MaterialBase | null;
  /** Última vez que el cliente avisó "Listo, ya subí todo" (lo escribe el servidor). */
  material_cliente_avisado_at?: string | null;
  historial: HistorialVideo[];
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface MarcaCorreccion {
  /** Segundo del video. */
  t: number;
  texto: string;
  /** Quién la marcó: producción o el cliente. */
  de?: "equipo" | "cliente";
}

export type EstadoRodaje = "agendado" | "realizado" | "cancelado";

export interface Rodaje {
  id: string;
  proyecto_id: string;
  fecha: string; // YYYY-MM-DD
  hora: string | null; // HH:mm
  lugar: string | null;
  notas: string | null;
  estado: EstadoRodaje;
  /** Qué tiene que tener listo el cliente (se le avisa el día antes). */
  preparar?: string | null;
  /** Cuándo se mandó el aviso del día anterior. */
  recordatorio_at?: string | null;
  video_ids: string[];
  productor_id: string | null;
  created_at: string;
  created_by: string;
}

// ---------------------------------------------------------------------------
// Plan del mes con IA (planes_mes/{proyecto}_{mes}) y lo que la IA aprende (ia_memoria/{proyecto})
// ---------------------------------------------------------------------------

export interface IdeaPlan {
  id: string;
  titulo: string;
  idea: string;
  objetivo: string | null;
  /** Por qué la propone la IA (solo para el equipo). */
  porque?: string | null;
  origen: "ia" | "equipo";
  respuesta?: { ok: boolean; comentario?: string | null } | null;
  video_id?: string | null;
  descartada?: boolean;
}

export type EstadoPlanMes = "borrador" | "enviado" | "respondido" | "cerrado";

export interface PlanMes {
  id: string;
  proyecto_id: string;
  mes: string;
  estado: EstadoPlanMes;
  ideas: IdeaPlan[];
  ideas_ia?: IdeaPlan[];
  descartadas?: string[];
  cupo?: number;
  nota_equipo?: string | null;
  nota_cliente?: string | null;
  generado_at?: string;
  generado_por?: string;
  enviado_at?: string | null;
  enviado_por?: string | null;
  respondido_at?: string | null;
  recordatorios?: number;
  updated_at?: string;
}

export interface MemoriaIA {
  resumen?: string;
  notas_equipo?: string;
  ejemplos?: { mes: string; at: string; tipo: string }[];
  actualizado_at?: string;
  comercial?: ContextoComercial;
  /** Lo que la IA sacó de los chats del cliente (resumen diario o "@prodi acordate que …"). */
  chat_notas?: { texto: string; fuente: "chat"; at: string; chat_id: string; por?: string | null }[];
}

/** Lo que vende el cliente y cómo le conseguimos consultas (lo usa la IA). Va en ia_memoria/{cliente}. */
export interface ProductoComercial {
  id: string;
  nombre: string;
  detalle?: string | null;
  precio?: string | null;
  destacado?: boolean;
}
export interface TemporadaComercial {
  id: string;
  titulo: string;
  detalle?: string | null;
  desde?: string | null;
  hasta?: string | null;
}
export interface ContextoComercial {
  enfoque?: string;
  objetivo?: string;
  productos?: ProductoComercial[];
  temporadas?: TemporadaComercial[];
  actualizado_at?: string;
}

export type FormatoPieza =
  // Redes
  | "cuadrado"
  | "posteo_vertical"
  | "vertical"
  | "horizontal"
  // Impresión y cartelería
  | "afiche"
  | "vidriera"
  | "banner";

export type EstadoPieza =
  | "pendiente_pago" // El cliente la pidió y tiene que pagar
  | "pagada" // Pagada o incluida en el plan: diseño la tiene que hacer
  | "en_proceso" // Diseño la está armando (o corrigiendo lo que pidió el cliente)
  | "para_aprobar" // Diseño le mandó una versión al cliente
  | "entregada" // El cliente la aprobó: lista para descargar
  | "rechazada" // El equipo no la puede hacer (se reembolsa)
  | "cancelada";

export interface VersionPieza {
  id: string;
  drive_file_id: string;
  name: string;
  mime_type: string;
  web_view_link: string;
  thumbnail_link?: string;
  prompt: string;
  created_at: string;
  created_by: string;
}

export type EnfoquePieza = "comercial" | "institucional";

export interface PiezaIA {
  id: string;
  proyecto_id: string;
  solicitado_por: string;
  /** Qué quiere el cliente, con sus palabras. */
  pedido: string;
  texto_en_pieza: string | null;
  formato: FormatoPieza;
  /** Para vender (comercial) o para comunicar (institucional). Las viejas no lo tienen. */
  enfoque?: EnfoquePieza;
  producto?: string | null;
  /** Precio o promo que tiene que aparecer. */
  oferta?: string | null;
  /** Qué tiene que hacer la gente: escribir por WhatsApp, venir al local… */
  cta?: string | null;
  /** Mes en que se pidió (para contar las incluidas en el plan). */
  mes?: string;
  /** Para cuándo la necesita el cliente (YYYY-MM-DD). */
  fecha_deseada?: string | null;
  /** Entró en las piezas del plan (no se cobró aparte). */
  incluida?: boolean;
  precio: number;
  estado: EstadoPieza;
  cobro_id: string | null;
  /** Versiones hechas con IA. */
  versiones: VersionPieza[];
  /** Diseños que subió diseño a mano. */
  attachments_finalizado?: import("@/integrations/firebase/types").DriveAttachmentRef[];
  /** La versión que se le mandó al cliente para aprobar. */
  version_enviada_id?: string | null;
  version_aprobada_id: string | null;
  feedback_cliente?: string | null;
  rondas?: number;
  historial?: HistorialVideo[];
  nota_equipo: string | null;
  created_at: string;
  updated_at: string;
  /** Traída de un sistema anterior (progreso / postgo). */
  _origen?: string;
  _viejo?: import("@/components/redes/DelSistemaAnterior").DatosViejos | null;
}

export type TipoCobro = "pieza_ia" | "video_extra" | "abono";
export type EstadoCobro =
  | "pendiente"
  | "aprobado"
  | "rechazado"
  | "reembolsado"
  | "cancelado";

export interface Cobro {
  id: string;
  proyecto_id: string;
  tipo: TipoCobro;
  concepto: string;
  /** Pieza IA (id) o mes del video extra (YYYY-MM). */
  ref_id: string;
  cantidad: number;
  monto: number;
  /** Abono por débito: lo que se quedó Mercado Pago de comisión (va incluido en `monto`). */
  comision_mp?: number | null;
  moneda: "ARS";
  estado: EstadoCobro;
  mp_preference_id?: string | null;
  mp_init_point?: string | null;
  mp_payment_id?: string | null;
  created_by: string;
  created_at: string;
  pagado_at?: string | null;
}

export interface PlanRedes {
  id: string;
  nombre: string;
  descripcion?: string | null;
  videos_mes: number;
  /** Piezas gráficas incluidas por mes (las demás se cobran aparte). */
  piezas_mes?: number;
  precio_mensual: number;
  precio_video_extra: number;
  activo: boolean;
  orden: number;
}

export interface DatosCobro {
  titular: string;
  cuit: string;
  banco: string;
  alias: string;
  cbu: string;
  /** Mail para mandar comprobantes (opcional: sale en la boleta). */
  email?: string;
}

export interface RedesSettings {
  /** Precio de cada pieza gráfica para redes fuera del plan (ARS). */
  precio_pieza_ia: number;
  /** Precio de cada pieza para imprimir (afiche, cartel, banner) fuera del plan. */
  precio_pieza_impresion?: number;
  /** Facturación: día del mes siguiente en que vence (por defecto 5). */
  dia_vencimiento?: number;
  /** Comisión que se queda Mercado Pago en el débito automático (% de lo cobrado, IVA incluido). Se suma al débito. */
  comision_mp_pct?: number;
  /** IVA de las facturas (las boletas no llevan). */
  iva_pct?: number;
  /** Datos que salen en la boleta para transferir. */
  cobro?: DatosCobro;
  /** Días en una etapa a partir de los cuales un video se marca como trabado. */
  dias_alerta: number;
  /** Envío automático del informe mensual el día 1. */
  informe_automatico: boolean;
  /** Servidor de videollamadas (Jitsi). Por defecto el público y gratis. */
  jitsi_base?: string;
  /** Cómo trabaja Prodi lo comercial: lo lee la IA en todo lo que arma. */
  ia_enfoque?: string;
  /** Con qué IA se hacen las imágenes de las piezas (por defecto ChatGPT). */
  ia_imagenes?: "openai" | "gemini";
}

export const DATOS_COBRO_DEFAULT: DatosCobro = {
  titular: "Lucas Agustín Paulón",
  cuit: "20-42033474-6",
  banco: "Banco Galicia",
  alias: "prodiredes",
  cbu: "0070345930004013137772",
  email: "",
};

export const DEFAULT_REDES_SETTINGS: RedesSettings = {
  precio_pieza_ia: 15000,
  precio_pieza_impresion: 25000,
  dia_vencimiento: 5,
  iva_pct: 21,
  cobro: DATOS_COBRO_DEFAULT,
  dias_alerta: 3,
  informe_automatico: true,
  jitsi_base: "https://meet.jit.si",
};

// ---------------------------------------------------------------------------
// Chat interno
// ---------------------------------------------------------------------------

export type TipoChat = "equipo" | "cliente" | "directo" | "grupo" | "prodi";

export interface Chat {
  /** Equipo / grupo de cliente que el super admin borró: queda sin miembros y la app no lo vuelve a crear. */
  borrado?: boolean;
  /** Equipo / grupo de cliente con nombre puesto a mano por el super admin (la sincronización no lo pisa). */
  nombre_propio?: boolean;
  id: string;
  tipo: TipoChat;
  proyecto_id: string | null;
  nombre: string | null;
  miembros: string[];
  ultimo: { texto: string; by: string; at: string } | null;
  /** Nombres de los miembros (los clientes no pueden leer los perfiles del equipo). */
  nombres?: Record<string, string>;
  /** Grupo de un cliente: quiénes son contactos (solo chat), para marcarlos aunque no se lean sus perfiles. */
  contactos?: string[];
  /** Última lectura de cada miembro: { uid: ISO } */
  leido: Record<string, string>;
  created_at: string;
  /** Foto del chat (JPEG cuadrado chico en data URL). Grupos, "equipo" y los de cada cliente. */
  foto?: string | null;
  /** Grupos armados por los usuarios: quiénes los administran y cómo se ven sin foto. */
  admins?: string[];
  creado_por?: string;
  emoji?: string | null;
  color?: string | null;
}

/** "archivo" y "bot" (respuestas de @prodi) solo los escribe el servidor. */
export type TipoMensaje = "texto" | "llamada" | "minuta" | "sistema" | "audio" | "archivo" | "bot";

/** Archivo mandado por el chat (está en Drive; se ve con /api/drive/media-token si sos miembro del chat). */
export interface ArchivoChat {
  drive_file_id: string;
  name: string;
  mime_type: string;
  size: number;
  /** Mandado "como documento": se muestra como archivo para bajar (original, sin vista previa). */
  documento?: boolean;
}

export interface Mensaje {
  id: string;
  texto: string;
  by: string;
  at: string;
  tipo: TipoMensaje;
  by_nombre?: string;
  link?: string | null;
  reunion_id?: string | null;
  /** Mensaje de voz: el audio está en chats/{chat}/audios/{id} (se baja al reproducirlo). */
  audio?: { id: string; mime: string; duracion: number } | null;
  archivo?: ArchivoChat | null;
  /** Texto que acompaña al archivo. */
  leyenda?: string | null;
  /** Respuestas de @prodi: texto del botón del link. */
  link_texto?: string | null;
  tarea_id?: string | null;
  /** Respuesta a otro mensaje: lo que se muestra citado arriba. */
  responde_a?: { id: string; by: string; by_nombre?: string; texto: string } | null;
  /** Personas mencionadas con @nombre (les llega un aviso aparte). */
  menciones?: string[];
  /** Reacciones: { "👍": [uid, …] }. */
  reacciones?: Record<string, string[]>;
  /** Si el autor lo corrigió después de mandarlo. */
  editado_at?: string | null;
}

/** Tareas que deja @prodi ("recordale a Lucía que mande el guion el viernes"). */
export interface Tarea {
  id: string;
  titulo: string;
  asignados: string[];
  /** YYYY-MM-DD o null. */
  vence: string | null;
  /** Día del vencimiento en ISO (00:00 AR → 00:00 AR del día siguiente). */
  vence_inicio?: string | null;
  vence_fin?: string | null;
  hecha: boolean;
  hecha_at?: string | null;
  hecha_por?: string | null;
  creada_por: string;
  creada_por_nombre?: string;
  chat_id: string | null;
  proyecto_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Reuniones (videollamadas) y minutas
// ---------------------------------------------------------------------------

export interface TareaMinuta {
  tarea: string;
  responsable?: string | null;
  fecha?: string | null;
}

export interface Minuta {
  resumen: string;
  temas: string[];
  acuerdos: string[];
  tareas: TareaMinuta[];
  generado_at: string;
  fuente: "audio" | "notas" | "manual";
}

export interface Reunion {
  id: string;
  titulo: string;
  proyecto_id: string | null;
  chat_id: string | null;
  /** ISO de inicio */
  fecha: string;
  /** ISO de fin y duración (las que crea @prodi los tienen). */
  fin?: string | null;
  duracion_min?: number | null;
  /** Link de la videollamada (Jitsi Meet, gratis). */
  link: string;
  participantes: string[];
  creada_por: string;
  estado: "programada" | "realizada";
  /** Grabaciones de audio subidas a Drive (la última se usa para la minuta). */
  attachments_crudo?: import("@/integrations/firebase/types").DriveAttachmentRef[];
  notas: string | null;
  minuta: Minuta | null;
  created_at: string;
}
