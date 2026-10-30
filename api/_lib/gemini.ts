/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente mínimo de Gemini (REST). La clave queda solo en el servidor.

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function key(): string {
  // Sin espacios ni comillas pegados al copiarla. Va en el encabezado x-goog-api-key (sirve para las claves AIza… y las nuevas AQ.…).
  const k = (process.env.GEMINI_API_KEY ?? "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
  if (!k) throw new Error("Falta GEMINI_API_KEY en Vercel");
  return k;
}

export const TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash";
/** Imágenes: Nano Banana Pro (el más avanzado; escribe bien el texto dentro de la pieza). Si no está disponible, los de respaldo. */
export const IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";
const IMAGE_RESPALDO = ["gemini-nano-banana-2.1", "gemini-2.5-flash-image"];

/** Modelos que Google dio de baja → el que sugirió en su lugar (se aprende solo, ver call). */
const REEMPLAZOS = new Map<string, string>();

async function call(model: string, payload: unknown, reintento = false): Promise<any> {
  model = REEMPLAZOS.get(model) ?? model;
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify(payload),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const crudo = String(json?.error?.message ?? `Gemini respondió ${res.status}`);
    // Google dio de baja el modelo y sugiere otro ("…no longer available… use models/gemini-X…"): se usa ese y se reintenta.
    const sugerido = /no longer available|deprecated|not found|is not supported/i.test(crudo) ? /models\/(gemini-[\w.-]+)/i.exec(crudo.replace(`models/${model}`, ""))?.[1] : undefined;
    if (!reintento && sugerido && sugerido !== model) {
      console.warn(`[gemini] ${model} dado de baja: uso ${sugerido}`);
      REEMPLAZOS.set(model, sugerido);
      return call(sugerido, payload, true);
    }
    // Lo más común: la clave es del plan gratis (o se pasó del límite). Que se entienda qué hacer.
    const msg =
      res.status === 429 || /quota|RESOURCE_EXHAUSTED|rate limit/i.test(crudo)
        ? "Gemini: se terminó la cuota de la clave. Hay que activar la facturación del proyecto en aistudio.google.com (API keys → Configurar facturación) o esperar a que se renueve."
        : crudo;
    throw new Error(`IA: ${msg}`);
  }
  return json;
}

/** Voz natural (texto → audio). Modelo y voz se pueden cambiar en Vercel. */
export const TTS_MODEL = () => process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const TTS_VOZ = () => process.env.GEMINI_TTS_VOZ || "Sulafat";

/**
 * Lee un texto con voz natural. Gemini devuelve PCM crudo (16 bits, mono, 24 kHz): se le arma el encabezado
 * WAV para que el navegador lo reproduzca directo.
 */
export async function hablar(texto: string, estilo: string): Promise<{ data: Buffer; mime: string }> {
  const json = await call(TTS_MODEL(), {
    contents: [{ parts: [{ text: `${estilo}\n\n${texto}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOZ() } } },
    },
  });
  const inline = json?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData ?? p.inline_data);
  const d = inline?.inlineData ?? inline?.inline_data;
  if (!d?.data) throw new Error("IA: no se pudo generar la voz.");
  const pcm = Buffer.from(d.data, "base64");
  const rate = Number(/rate=(\d+)/.exec(String(d.mimeType ?? d.mime_type ?? ""))?.[1] ?? 24000);
  return { data: wav(pcm, rate), mime: "audio/wav" };
}

/** Encabezado WAV (PCM 16 bits, mono). */
function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Devuelve una lista de textos (JSON estructurado). */
export async function generarTextos(prompt: string, cantidad = 3): Promise<string[]> {
  const json = await call(TEXT_MODEL(), {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.9,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { opciones: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["opciones"],
      },
    },
  });
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  try {
    const parsed = JSON.parse(text) as { opciones?: string[] };
    return (parsed.opciones ?? []).filter((s) => typeof s === "string" && s.trim()).slice(0, cantidad);
  } catch {
    return text ? [text.trim()] : [];
  }
}

/** Respuesta estructurada (JSON con el esquema indicado). */
export async function generarJSON<T>(prompt: string, schema: unknown, temperature = 0.6, adjuntos: { data: Buffer; mime: string }[] = []): Promise<T> {
  const json = await call(TEXT_MODEL(), {
    contents: [{ role: "user", parts: [...adjuntos.map((a) => ({ inline_data: { mime_type: a.mime, data: a.data.toString("base64") } })), { text: prompt }] }],
    generationConfig: { temperature, responseMimeType: "application/json", responseSchema: schema },
  });
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("IA: la respuesta vino incompleta. Probá de nuevo.");
  }
}

/** Genera una imagen. Devuelve el binario y su mime. */
export async function generarImagen(
  prompt: string,
  aspectRatio: "1:1" | "4:5" | "9:16" | "16:9" | "2:3" | "3:4" | "21:9",
  /** Imágenes de referencia (logo, piezas de la marca). */
  imagenes: { data: Buffer; mime: string }[] = []
): Promise<{ data: Buffer; mime: string; modelo: string }> {
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          ...imagenes.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data.toString("base64") } })),
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio },
    },
  };
  // Si el modelo elegido no existe para esta clave (o lo dieron de baja), prueba con los de respaldo.
  let json: any;
  let usado = IMAGE_MODEL();
  const modelos = [IMAGE_MODEL(), ...IMAGE_RESPALDO.filter((m) => m !== IMAGE_MODEL())];
  for (const [k, m] of modelos.entries()) {
    try {
      // El Pro hace la imagen en 2K (más nítida); si no acepta ese tamaño, va en el tamaño base.
      const conTamano = /pro/i.test(m)
        ? { ...payload, generationConfig: { ...payload.generationConfig, imageConfig: { aspectRatio, imageSize: "2K" } } }
        : payload;
      json = await call(m, conTamano).catch((e) => {
        if (conTamano !== payload && /imageSize|image_size|Invalid|INVALID_ARGUMENT/i.test(String(e))) return call(m, payload);
        throw e;
      });
      usado = m;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (k === modelos.length - 1 || !/not found|is not supported|404|NOT_FOUND/i.test(msg)) throw err;
      console.warn(`[gemini] ${m} no disponible, pruebo ${modelos[k + 1]}`);
    }
  }
  const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const inline = img?.inlineData ?? img?.inline_data;
  if (!inline?.data) {
    const why = json?.candidates?.[0]?.finishReason ?? "sin imagen";
    throw new Error(`La IA no devolvió una imagen (${why}). Probá ajustar el pedido.`);
  }
  return { data: Buffer.from(inline.data, "base64"), mime: inline.mimeType ?? inline.mime_type ?? "image/png", modelo: usado };
}

const UPLOAD = "https://generativelanguage.googleapis.com/upload/v1beta/files";

/** Sube un archivo grande a la Files API de Gemini y espera a que esté listo. */
async function subirArchivoGemini(data: Buffer, mime: string, nombre: string): Promise<string> {
  const start = await fetch(UPLOAD, {
    method: "POST",
    headers: {
      "x-goog-api-key": key(),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(data.length),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: nombre } }),
  });
  const url = start.headers.get("x-goog-upload-url");
  if (!start.ok || !url) throw new Error(`IA: no se pudo subir el audio (${start.status})`);
  const up = await fetch(url, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: data,
  });
  const json: any = await up.json().catch(() => ({}));
  let file = json.file;
  if (!file?.uri) throw new Error("IA: la subida del audio no devolvió el archivo");
  for (let i = 0; i < 20 && file.state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const g: any = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { headers: { "x-goog-api-key": key() } })).json();
    file = g;
  }
  if (file.state !== "ACTIVE") throw new Error("IA: el audio todavía se está procesando o falló. Probá de nuevo en un minuto.");
  return file.uri as string;
}

export interface MinutaIA {
  resumen: string;
  temas: string[];
  acuerdos: string[];
  tareas: { tarea: string; responsable?: string | null; fecha?: string | null }[];
}

/** Arma la minuta a partir de un audio (o de texto si no hay audio). */
/** Minuta de una reunión. Con varias partes de audio (se cortó la grabación), van todas en orden. */
export async function generarMinutaIA(prompt: string, audio?: { data: Buffer; mime: string } | { data: Buffer; mime: string }[]): Promise<MinutaIA> {
  const parts: any[] = [{ text: prompt }];
  const audios = audio ? (Array.isArray(audio) ? audio : [audio]) : [];
  const total = audios.reduce((n, a) => n + a.data.length, 0);
  for (const a of audios) {
    const mime = comoVideo((a.mime.split(";")[0] || "audio/webm").toLowerCase());
    if (total <= 14 * 1024 * 1024) {
      parts.push({ inline_data: { mime_type: mime, data: a.data.toString("base64") } });
    } else {
      const uri = await subirArchivoGemini(a.data, mime, "reunion");
      parts.push({ file_data: { mime_type: mime, file_uri: uri } });
    }
  }
  const json = await call(TEXT_MODEL(), {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          resumen: { type: "STRING" },
          temas: { type: "ARRAY", items: { type: "STRING" } },
          acuerdos: { type: "ARRAY", items: { type: "STRING" } },
          tareas: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { tarea: { type: "STRING" }, responsable: { type: "STRING" }, fecha: { type: "STRING" } },
              required: ["tarea"],
            },
          },
        },
        required: ["resumen", "temas", "acuerdos", "tareas"],
      },
    },
  });
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  const parsed = JSON.parse(text) as MinutaIA;
  return {
    resumen: String(parsed.resumen ?? ""),
    temas: (parsed.temas ?? []).map(String),
    acuerdos: (parsed.acuerdos ?? []).map(String),
    tareas: (parsed.tareas ?? []).map((t) => ({ tarea: String(t.tarea ?? ""), responsable: t.responsable || null, fecha: t.fecha || null })),
  };
}

/** Pasa a texto un mensaje de voz (español rioplatense). */
/** Lo que graban los navegadores (WebM en Chrome, MP4/M4A en iPhone): Gemini lo lee seguro como video (escucha su audio). */
export function comoVideo(mime: string): string {
  return /webm/.test(mime) ? "video/webm" : /mp4|m4a|quicktime|aac/.test(mime) ? "video/mp4" : mime;
}

export async function transcribirAudio(data: Buffer, mime: string, pista?: string): Promise<string> {
  const base = (mime.split(";")[0] || "audio/webm").toLowerCase();
  try {
    return await transcribirCon(data, base, pista);
  } catch (err) {
    // Si Gemini no aceptó el formato como audio, se prueba como video (mismo archivo).
    const alt = comoVideo(base);
    if (alt === base) throw err;
    return transcribirCon(data, alt, pista);
  }
}

async function transcribirCon(data: Buffer, mime: string, pista?: string): Promise<string> {
  const json = await call(TEXT_MODEL(), {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Transcribí este mensaje de voz en español (Argentina) tal cual lo dice, sin agregar nada. Si no se entiende, devolvé vacío." +
              (pista ? `\n${pista}` : ""),
          },
          { inline_data: { mime_type: mime, data: data.toString("base64") } },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  });
  return (json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "").trim();
}
