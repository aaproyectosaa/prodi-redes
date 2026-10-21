import { callApi } from "@/lib/redes/api";
import { comprimirFoto } from "@/lib/imagen";

// Lo que se le pasa a la IA de Presupuestos: capturas (achicadas), PDF, el chat de WhatsApp exportado (.txt o el
// .zip tal cual, con sus fotos y audios, que se pasan a texto) o notas de voz sueltas.

export interface Archivo {
  id: string;
  nombre: string;
  tipo: "imagen" | "pdf" | "chat";
  /** Imagen o PDF en base64 (para la IA). */
  data?: string;
  mime?: string;
  /** Texto del chat. */
  texto?: string;
  vista?: string;
}

export const aBase64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
const nuevoId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const MIME_AUDIO: Record<string, string> = { opus: "audio/ogg", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav", amr: "audio/amr" };

/**
 * Los audios del chat exportado "con archivos": se pasan a texto y cada uno queda en el chat donde estaba
 * (WhatsApp deja el nombre del archivo en esa línea). Hasta 15 audios de hasta 3 MB.
 */
async function transcribirAudios(
  chat: string,
  audios: { nombre: string; blob: Blob; mime: string }[],
  progreso?: (n: number, total: number) => void
): Promise<string> {
  let texto = chat;
  const lista = audios.filter((a) => a.blob.size <= 3 * 1024 * 1024).slice(0, 15);
  for (let i = 0; i < lista.length; i++) {
    progreso?.(i + 1, lista.length);
    const a = lista[i];
    try {
      const r = await callApi<{ texto: string }>("/api/ia/voz-escuchar", { data: await aBase64(a.blob), mime: a.mime });
      const dicho = (r.texto || "(no se entendió)").trim();
      const corto = a.nombre.split("/").pop() ?? a.nombre;
      if (texto.includes(corto)) texto = texto.split(corto).join(`${corto} → AUDIO TRANSCRIPTO: "${dicho}"`);
      else texto += `\n[Audio ${corto}: "${dicho}"]`;
    } catch {
      /* si uno falla, siguen los demás */
    }
  }
  return texto;
}

/** Lee lo que se adjunta: fotos (achicadas), PDF, el .txt del chat o el .zip que exporta WhatsApp (con sus audios). */
export async function leer(f: File, progreso?: (n: number, total: number) => void): Promise<Archivo[]> {
  const nombre = f.name || "archivo";
  if (f.type.startsWith("image/")) {
    const chica = await comprimirFoto(f, 1600, 0.82);
    return [{ id: nuevoId(), nombre, tipo: "imagen", data: await aBase64(chica), mime: chica.type || "image/jpeg", vista: URL.createObjectURL(chica) }];
  }
  if (f.type === "application/pdf" || /\.pdf$/i.test(nombre)) {
    if (f.size > 3 * 1024 * 1024) throw new Error(`${nombre}: el PDF pesa más de 3 MB`);
    return [{ id: nuevoId(), nombre, tipo: "pdf", data: await aBase64(f), mime: "application/pdf" }];
  }
  if (/\.zip$/i.test(nombre) || f.type.includes("zip")) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(f);
    const out: Archivo[] = [];
    const txts = Object.values(zip.files).filter((z) => !z.dir && /\.txt$/i.test(z.name));
    const audios = await Promise.all(
      Object.values(zip.files)
        .filter((z) => !z.dir && /\.(opus|ogg|m4a|mp3|aac|wav|amr)$/i.test(z.name))
        .map(async (z) => ({ nombre: z.name, blob: await z.async("blob"), mime: MIME_AUDIO[z.name.split(".").pop()!.toLowerCase()] ?? "audio/ogg" }))
    );
    for (const z of txts.slice(0, 1)) {
      const chat = await z.async("string");
      out.push({
        id: nuevoId(),
        nombre: `${nombre}${audios.length ? ` · ${audios.length} audio${audios.length === 1 ? "" : "s"}` : ""}`,
        tipo: "chat",
        texto: audios.length ? await transcribirAudios(chat, audios, progreso) : chat,
      });
    }
    // Las fotos del chat también ayudan (hasta 4).
    const fotos = Object.values(zip.files).filter((z) => !z.dir && /\.(jpe?g|png|webp)$/i.test(z.name)).slice(0, 4);
    for (const z of fotos) {
      const blob = await z.async("blob");
      const chica = await comprimirFoto(new File([blob], z.name, { type: /\.png$/i.test(z.name) ? "image/png" : "image/jpeg" }), 1400, 0.8);
      out.push({ id: nuevoId(), nombre: z.name.split("/").pop() ?? "foto", tipo: "imagen", data: await aBase64(chica), mime: chica.type || "image/jpeg", vista: URL.createObjectURL(chica) });
    }
    if (!out.length) throw new Error(`${nombre}: no encontré el chat adentro del .zip`);
    return out;
  }
  if (/\.txt$/i.test(nombre) || f.type.startsWith("text/")) return [{ id: nuevoId(), nombre, tipo: "chat", texto: await f.text() }];
  // Un audio suelto (nota de voz descargada): se pasa a texto.
  if (f.type.startsWith("audio/") || /\.(opus|ogg|m4a|mp3|aac|wav|amr)$/i.test(nombre)) {
    const mime = f.type || MIME_AUDIO[nombre.split(".").pop()!.toLowerCase()] || "audio/ogg";
    const texto = await transcribirAudios("", [{ nombre, blob: f, mime }], progreso);
    return [{ id: nuevoId(), nombre: `Audio: ${nombre}`, tipo: "chat", texto }];
  }
  throw new Error(`${nombre}: mandá capturas, PDF o el chat de WhatsApp (.txt o .zip)`);
}

