/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente mínimo de Gemini (REST). La clave queda solo en el servidor.

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("Falta GEMINI_API_KEY en Vercel");
  return k;
}

export const TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
export const IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

async function call(model: string, payload: unknown): Promise<any> {
  const res = await fetch(`${BASE}/${model}:generateContent?key=${key()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? `Gemini respondió ${res.status}`;
    throw new Error(`IA: ${msg}`);
  }
  return json;
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
export async function generarJSON<T>(prompt: string, schema: unknown, temperature = 0.6): Promise<T> {
  const json = await call(TEXT_MODEL(), {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
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
): Promise<{ data: Buffer; mime: string }> {
  const json = await call(IMAGE_MODEL(), {
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
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio },
    },
  });
  const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const inline = img?.inlineData ?? img?.inline_data;
  if (!inline?.data) {
    const why = json?.candidates?.[0]?.finishReason ?? "sin imagen";
    throw new Error(`La IA no devolvió una imagen (${why}). Probá ajustar el pedido.`);
  }
  return { data: Buffer.from(inline.data, "base64"), mime: inline.mimeType ?? inline.mime_type ?? "image/png" };
}

const UPLOAD = "https://generativelanguage.googleapis.com/upload/v1beta/files";

/** Sube un archivo grande a la Files API de Gemini y espera a que esté listo. */
async function subirArchivoGemini(data: Buffer, mime: string, nombre: string): Promise<string> {
  const start = await fetch(`${UPLOAD}?key=${key()}`, {
    method: "POST",
    headers: {
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
    const g: any = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${key()}`)).json();
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
export async function generarMinutaIA(prompt: string, audio?: { data: Buffer; mime: string }): Promise<MinutaIA> {
  const parts: any[] = [{ text: prompt }];
  if (audio) {
    const mime = audio.mime.split(";")[0] || "audio/webm";
    if (audio.data.length <= 14 * 1024 * 1024) {
      parts.push({ inline_data: { mime_type: mime, data: audio.data.toString("base64") } });
    } else {
      const uri = await subirArchivoGemini(audio.data, mime, "reunion");
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
