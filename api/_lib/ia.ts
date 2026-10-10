/* eslint-disable @typescript-eslint/no-explicit-any */
// IA del sistema: cada tarea con la que mejor la hace. Las claves quedan solo en el servidor.
//
// - Texto (copys, guiones, plan del mes, @prodi en el chat, memoria de los chats, minutas escritas): Claude
//   (ANTHROPIC_API_KEY; modelo en ANTHROPIC_MODEL, por defecto Claude Opus 5.5). Sin esa clave, Gemini.
// - Imágenes de las piezas, minutas desde el audio de una reunión y mensajes de voz del chat: Gemini
//   (GEMINI_API_KEY). Claude no hace imágenes ni escucha audio. ChatGPT no se usa.
//
// Los esquemas de las respuestas se escriben como antes (formato de Gemini: OBJECT, STRING…) y acá se
// pasan a JSON Schema para Claude, así no cambia nada en quien los usa.

import Anthropic from "@anthropic-ai/sdk";
import * as gemini from "./gemini";

export type { MinutaIA } from "./gemini";
type Esfuerzo = "low" | "medium" | "high";
/** Imagen para que Claude la vea (JPEG, PNG, GIF o WebP). */
export type Imagen = { data: Buffer; mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
type Ratio = "1:1" | "4:5" | "9:16" | "16:9" | "2:3" | "3:4" | "21:9";

const MODELO = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const hayClaude = () => !!(process.env.ANTHROPIC_API_KEY ?? "").replace(/[\s"']/g, "");
const hayGemini = () => !!process.env.GEMINI_API_KEY?.trim();

/** La clave como viene de Vercel, sin espacios, saltos de línea ni comillas pegados al copiarla. */
const claveClaude = () => (process.env.ANTHROPIC_API_KEY ?? "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");

let cliente: Anthropic | null = null;
const claude = () => (cliente ??= new Anthropic({ apiKey: claveClaude() }));

/** Esquema estilo Gemini (OBJECT, STRING, nullable…) → JSON Schema de Claude (objetos cerrados). */
function aJsonSchema(s: any): any {
  if (!s || typeof s !== "object") return s;
  const tipo = String(s.type ?? "").toLowerCase();
  let out: any;
  if (tipo === "object") {
    const props = Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, aJsonSchema(v)]));
    out = { type: "object", properties: props, additionalProperties: false };
    if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  } else if (tipo === "array") {
    out = { type: "array", items: aJsonSchema(s.items ?? { type: "STRING" }) };
  } else {
    out = { type: tipo || "string" };
    if (Array.isArray(s.enum)) out.enum = s.enum;
  }
  if (s.description) out.description = s.description;
  return s.nullable ? { anyOf: [out, { type: "null" }] } : out;
}

/** Errores de Claude en castellano (la clave mal o faltante se dice clara: no es "probá en un rato"). */
function errorClaude(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    // Sin mostrar la clave: solo cómo empieza y cuánto mide, para ver si se pegó mal o incompleta.
    console.error(`[ia] Claude rechazó la clave (${claveClaude().length} caracteres)`);
    return new Error("IA: la clave de Claude (ANTHROPIC_API_KEY) no es válida. Revisala en Vercel.");
  }
  if (err instanceof Anthropic.PermissionDeniedError) return new Error("IA: la clave de Claude no tiene permiso o la cuenta no tiene saldo.");
  if (err instanceof Anthropic.RateLimitError) return new Error("IA: muchos pedidos seguidos. Probá en un minuto.");
  if (err instanceof Anthropic.APIError) return new Error(`IA: Claude respondió ${err.status ?? "con un error"}. Probá de nuevo.`);
  return err instanceof Error ? err : new Error(String(err));
}

/** Una respuesta JSON de Claude con el esquema pedido. */
async function jsonClaude<T>(prompt: string, schema: unknown, esfuerzo: Esfuerzo, imagenes: Imagen[] = []): Promise<T> {
  let r: Anthropic.Beta.BetaMessage;
  try {
    r = await claude().beta.messages.create({
      model: MODELO(),
      max_tokens: 16000,
      // Si el modelo declina un pedido, el servidor lo reintenta solo con otro modelo.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: esfuerzo, format: { type: "json_schema", schema: aJsonSchema(schema) } },
      messages: [
        {
          role: "user",
          content: imagenes.length
            ? [
                ...imagenes.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mime, data: i.data.toString("base64") } })),
                { type: "text" as const, text: prompt },
              ]
            : prompt,
        },
      ],
    });
  } catch (err) {
    throw errorClaude(err);
  }
  if (r.stop_reason === "refusal") throw new Error("IA: no pudo responder ese pedido. Probá escribirlo de otra forma.");
  if (r.stop_reason === "max_tokens") throw new Error("IA: la respuesta vino incompleta. Probá de nuevo.");
  const texto = r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new Error("IA: la respuesta vino incompleta. Probá de nuevo.");
  }
}

function sinTexto(): never {
  throw new Error("Falta la clave de la IA en Vercel: cargá ANTHROPIC_API_KEY (Claude).");
}

/**
 * Respuesta estructurada. `temperature` viene de cuando era Gemini: Claude no la usa, pero sirve de pista
 * del tipo de pedido. Lo preciso y rápido (@prodi, memoria: ≤ 0,3) va con poco esfuerzo; lo creativo, medio.
 */
export async function generarJSON<T>(prompt: string, schema: unknown, temperature = 0.6, imagenes: Imagen[] = [], esfuerzo?: Esfuerzo): Promise<T> {
  if (hayClaude()) return jsonClaude<T>(prompt, schema, esfuerzo ?? (temperature <= 0.3 ? "low" : "medium"), imagenes);
  if (hayGemini()) return gemini.generarJSON<T>(prompt, schema, temperature);
  sinTexto();
}

/** Conversación en texto libre (el asistente del dueño). Solo Claude. */
export async function conversarClaude(system: string, mensajes: { role: "user" | "assistant"; content: string }[]): Promise<string> {
  if (!hayClaude()) sinTexto();
  let r: Anthropic.Beta.BetaMessage;
  try {
    r = await claude().beta.messages.create({
      model: MODELO(),
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system,
      messages: mensajes,
    });
  } catch (err) {
    throw errorClaude(err);
  }
  if (r.stop_reason === "refusal") throw new Error("IA: no pudo responder eso. Probá escribirlo de otra forma.");
  return r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

/** Varias opciones de texto (copys). */
export async function generarTextos(prompt: string, cantidad = 3): Promise<string[]> {
  if (!hayClaude()) {
    if (hayGemini()) return gemini.generarTextos(prompt, cantidad);
    sinTexto();
  }
  const r = await jsonClaude<{ opciones?: string[] }>(
    `${prompt}\n\nDevolvé ${cantidad} opciones distintas en "opciones".`,
    { type: "OBJECT", properties: { opciones: { type: "ARRAY", items: { type: "STRING" } } }, required: ["opciones"] },
    "medium"
  );
  return (r.opciones ?? []).filter((s) => typeof s === "string" && s.trim()).slice(0, cantidad);
}

const ESQUEMA_MINUTA = {
  type: "OBJECT",
  properties: {
    resumen: { type: "STRING" },
    temas: { type: "ARRAY", items: { type: "STRING" } },
    acuerdos: { type: "ARRAY", items: { type: "STRING" } },
    tareas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { tarea: { type: "STRING" }, responsable: { type: "STRING", nullable: true }, fecha: { type: "STRING", nullable: true } },
        required: ["tarea", "responsable", "fecha"],
      },
    },
  },
  required: ["resumen", "temas", "acuerdos", "tareas"],
};

/** Minuta de una reunión: con audio la arma Gemini (lo escucha entero); con notas escritas, Claude. */
export async function generarMinutaIA(prompt: string, audio?: { data: Buffer; mime: string }): Promise<gemini.MinutaIA> {
  if (audio) {
    if (!hayGemini()) throw new Error("Para armar la minuta desde el audio falta GEMINI_API_KEY en Vercel (con notas escritas anda igual).");
    return gemini.generarMinutaIA(prompt, audio);
  }
  if (!hayClaude()) return gemini.generarMinutaIA(prompt);
  const m = await jsonClaude<gemini.MinutaIA>(prompt, ESQUEMA_MINUTA, "medium");
  return {
    resumen: String(m.resumen ?? ""),
    temas: (m.temas ?? []).map(String),
    acuerdos: (m.acuerdos ?? []).map(String),
    tareas: (m.tareas ?? []).map((t) => ({ tarea: String(t.tarea ?? ""), responsable: t.responsable || null, fecha: t.fecha || null })),
  };
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

/** Genera una imagen con Gemini. Devuelve el binario y su mime. */
export async function generarImagen(
  prompt: string,
  aspectRatio: Ratio,
  /** Imágenes de referencia (logo, piezas de la marca). */
  imagenes: { data: Buffer; mime: string }[] = []
): Promise<{ data: Buffer; mime: string; modelo: string }> {
  if (!hayGemini()) throw new Error("Falta la clave de Gemini (GEMINI_API_KEY) en Vercel para hacer las imágenes.");
  return gemini.generarImagen(prompt, aspectRatio, imagenes);
}

/** Mensaje de voz a texto: Gemini (Claude no recibe audio). */
export async function transcribir(data: Buffer, mime: string): Promise<string> {
  if (!hayGemini()) throw new Error("Para entender audios falta la clave de Gemini (GEMINI_API_KEY) en Vercel.");
  try {
    return await gemini.transcribirAudio(data, mime);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    throw new Error(/API key|PERMISSION_DENIED/i.test(m) ? "Para entender audios: la clave de Gemini (GEMINI_API_KEY) no es válida. Hay que cargar una nueva en Vercel." : m);
  }
}
