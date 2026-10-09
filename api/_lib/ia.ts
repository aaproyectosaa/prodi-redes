/* eslint-disable @typescript-eslint/no-explicit-any */
// IA del sistema: cada tarea con la que mejor la hace. Las claves quedan solo en el servidor.
//
// - Texto (copys, guiones, plan del mes, @prodi en el chat, memoria de los chats, minutas escritas): Claude
//   (ANTHROPIC_API_KEY; modelo en ANTHROPIC_MODEL, por defecto Claude Opus 5.5). Sin esa clave, Gemini.
// - Imágenes de las piezas: ChatGPT (OPENAI_API_KEY) o Gemini (GEMINI_API_KEY), según Ajustes
//   (app_settings/redes.ia_imagenes). Si la elegida no tiene clave, se usa la otra.
// - Minutas desde el audio de una reunión: Gemini (es el que escucha audio largo de una vez).
//
// Los esquemas de las respuestas se escriben como antes (formato de Gemini: OBJECT, STRING…) y acá se
// pasan a JSON Schema para Claude, así no cambia nada en quien los usa.

import Anthropic from "@anthropic-ai/sdk";
import { adminDb } from "./db";
import * as gemini from "./gemini";

export type { MinutaIA } from "./gemini";
type Esfuerzo = "low" | "medium" | "high";
/** Imagen para que Claude la vea (JPEG, PNG, GIF o WebP). */
export type Imagen = { data: Buffer; mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
type Ratio = "1:1" | "4:5" | "9:16" | "16:9" | "2:3" | "3:4" | "21:9";

const MODELO = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const hayClaude = () => !!(process.env.ANTHROPIC_API_KEY ?? "").replace(/[\s"']/g, "");
const hayGemini = () => !!process.env.GEMINI_API_KEY?.trim();
const hayOpenAI = () => !!process.env.OPENAI_API_KEY?.trim();

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
    const k = claveClaude();
    console.error(`[ia] Claude rechazó la clave (empieza con ${k.slice(0, 10)}…, ${k.length} caracteres)`);
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
export async function generarJSON<T>(prompt: string, schema: unknown, temperature = 0.6, imagenes: Imagen[] = []): Promise<T> {
  if (hayClaude()) return jsonClaude<T>(prompt, schema, temperature <= 0.3 ? "low" : "medium", imagenes);
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

export type ProveedorImagenes = "openai" | "gemini";

/** Con qué se hacen las imágenes: lo elegido en Ajustes, si tiene clave; si no, el que tenga. */
async function proveedorImagenes(): Promise<ProveedorImagenes> {
  const cfg = (await adminDb().collection("app_settings").doc("redes").get()).data() ?? {};
  const elegido: ProveedorImagenes = cfg.ia_imagenes === "gemini" ? "gemini" : "openai";
  const tiene = (p: ProveedorImagenes) => (p === "openai" ? hayOpenAI() : hayGemini());
  if (tiene(elegido)) return elegido;
  const otro: ProveedorImagenes = elegido === "openai" ? "gemini" : "openai";
  if (tiene(otro)) return otro;
  throw new Error(
    elegido === "openai"
      ? "Falta la clave de ChatGPT (OPENAI_API_KEY) en Vercel para hacer las imágenes."
      : "Falta la clave de Gemini (GEMINI_API_KEY) en Vercel para hacer las imágenes."
  );
}

/** ChatGPT hace 3 tamaños: cuadrado, vertical (2:3) y horizontal (3:2). */
function tamanoOpenAI(ratio: Ratio): string {
  if (ratio === "1:1") return "1024x1024";
  if (ratio === "16:9" || ratio === "21:9") return "1536x1024";
  return "1024x1536";
}

async function imagenOpenAI(prompt: string, ratio: Ratio, imagenes: { data: Buffer; mime: string }[]): Promise<{ data: Buffer; mime: string }> {
  const modelo = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const calidad = process.env.OPENAI_IMAGE_QUALITY || "high";
  const size = tamanoOpenAI(ratio);
  // El formato exacto va en el pedido (el tamaño de ChatGPT es aproximado: 2:3 para 9:16 o 4:5).
  const texto = `${prompt}\n\nFormato de la pieza: ${ratio}. Dejá aire en los bordes para que se pueda recortar a ese formato sin cortar texto.`;
  const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` };
  let res: Response;
  if (imagenes.length) {
    // Con referencias (logo, piezas de la marca): edición con las imágenes de base.
    const form = new FormData();
    form.append("model", modelo);
    form.append("prompt", texto);
    form.append("size", size);
    form.append("quality", calidad);
    imagenes.slice(0, 10).forEach((img, i) => {
      const ext = img.mime.includes("jpeg") || img.mime.includes("jpg") ? "jpg" : img.mime.includes("webp") ? "webp" : "png";
      form.append("image[]", new Blob([new Uint8Array(img.data)], { type: img.mime }), `referencia-${i + 1}.${ext}`);
    });
    res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers, body: form });
  } else {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, prompt: texto, size, quality: calidad, n: 1 }),
    });
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Error("La clave de ChatGPT (OPENAI_API_KEY) no es válida. Revisala en Vercel.");
    if (res.status === 429) throw new Error("ChatGPT: sin saldo o muchos pedidos seguidos. Revisá el saldo en platform.openai.com.");
    throw new Error(`ChatGPT no pudo hacer la imagen: ${json?.error?.message ?? res.status}`);
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("ChatGPT no devolvió una imagen. Probá ajustar el pedido.");
  return { data: Buffer.from(b64, "base64"), mime: "image/png" };
}

/** Genera una imagen con el proveedor elegido en Ajustes. Devuelve el binario y su mime. */
export async function generarImagen(
  prompt: string,
  aspectRatio: Ratio,
  /** Imágenes de referencia (logo, piezas de la marca). */
  imagenes: { data: Buffer; mime: string }[] = []
): Promise<{ data: Buffer; mime: string }> {
  const p = await proveedorImagenes();
  return p === "openai" ? imagenOpenAI(prompt, aspectRatio, imagenes) : gemini.generarImagen(prompt, aspectRatio, imagenes);
}

/** Mensaje de voz a texto: Gemini o, si no hay, ChatGPT (gpt-4o-mini-transcribe). */
export async function transcribir(data: Buffer, mime: string): Promise<string> {
  if (hayGemini()) {
    try {
      return await gemini.transcribirAudio(data, mime);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (!hayOpenAI()) throw new Error(/API key|PERMISSION_DENIED/i.test(m) ? "Para entender audios: la clave de Gemini (GEMINI_API_KEY) no es válida. Hay que cargar una nueva en Vercel." : m);
      console.warn("[ia] Gemini no pudo con el audio, pruebo con ChatGPT", m);
    }
  }
  if (hayOpenAI()) {
    const tipo = mime.split(";")[0] || "audio/webm";
    const ext = tipo.includes("mp4") || tipo.includes("m4a") ? "m4a" : tipo.includes("ogg") ? "ogg" : tipo.includes("mpeg") ? "mp3" : "webm";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: tipo }), `audio.${ext}`);
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("language", "es");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(`IA: no se pudo pasar el audio a texto (${json.error?.message ?? res.status})`);
    return String(json.text ?? "").trim();
  }
  throw new Error("Para entender audios falta la clave de Gemini (GEMINI_API_KEY) o de ChatGPT (OPENAI_API_KEY) en Vercel.");
}
