import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, Image as ImageIcon, Loader2, MessageCircle, Mic, MicOff, Paperclip, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/redes/api";
import { comprimirFoto } from "@/lib/imagen";
import { cn } from "@/lib/utils";

// "Armalo con IA" en Presupuestos: el admin le cuenta (escribiendo o dictando) y le pasa capturas, PDF o el chat de
// WhatsApp exportado (.txt o el .zip tal cual), y la IA completa el presupuesto (api/_lib/presupuesto-ia.ts).

export interface ResultadoPresupuestoIA {
  empresa: string;
  contacto: { nombre: string | null; telefono: string | null; email: string | null };
  plan_id: string | null;
  items: { concepto: string; detalle: string | null; cantidad: number; precio: number; periodo: "mensual" | "unico" }[];
  moneda: "ARS" | "USD";
  tipo: "factura" | "boleta";
  validez_dias: number;
  nota: string;
  resumen: string;
  faltantes: string[];
}

interface Archivo {
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

const aBase64 = (b: Blob) =>
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
async function leer(f: File, progreso?: (n: number, total: number) => void): Promise<Archivo[]> {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Reconocimiento = (): any => (typeof window === "undefined" ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

export function PresupuestoIA({ actual, onResultado }: { actual: unknown; onResultado: (r: ResultadoPresupuestoIA) => void }) {
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<Pick<ResultadoPresupuestoIA, "resumen" | "faltantes"> | null>(null);
  const [dictando, setDictando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const rec = useRef<{ stop: () => void } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => rec.current?.stop(), []);

  const agregar = async (files: File[]) => {
    if (!files.length) return;
    setLeyendo(true);
    try {
      const listos = (
        await Promise.all(
          files.map((f) => leer(f, (n, total) => setProgreso(`Escuchando los audios del chat (${n} de ${total})…`)).catch((e) => (toast.error(e instanceof Error ? e.message : "No se pudo leer"), [])))
        )
      ).flat();
      setArchivos((prev) => [...prev, ...listos].slice(0, 10));
    } finally {
      setLeyendo(false);
      setProgreso(null);
    }
  };
  const quitar = (id: string) =>
    setArchivos((prev) => {
      const a = prev.find((x) => x.id === id);
      if (a?.vista) URL.revokeObjectURL(a.vista);
      return prev.filter((x) => x.id !== id);
    });

  // Dictado con el micrófono (lo que decís se va escribiendo).
  const dictar = () => {
    if (dictando) {
      rec.current?.stop();
      return;
    }
    const R = Reconocimiento();
    if (!R) {
      toast.error("Este navegador no deja dictar. Probá con Chrome o Edge.");
      return;
    }
    const r = new R();
    r.lang = "es-AR";
    r.continuous = true;
    r.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      let dicho = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) dicho += e.results[i][0].transcript;
      if (dicho.trim()) setTexto((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${dicho.trim()}`);
    };
    r.onerror = () => setDictando(false);
    r.onend = () => {
      setDictando(false);
      rec.current = null;
    };
    rec.current = { stop: () => r.stop() };
    r.start();
    setDictando(true);
  };

  // Audios que figuran en el chat pero no vinieron (exportado sin archivos o desde la compu).
  const audiosFaltantes = archivos
    .filter((a) => a.tipo === "chat")
    .reduce((n, a) => n + ((a.texto ?? "").match(/mensaje de voz omitido|\[mensaje de voz\]|audio omitido|<adjunto omitido>/gi)?.length ?? 0), 0);
  const audiosSueltos = archivos.filter((a) => a.nombre.startsWith("Audio:")).length;

  const armar = async () => {
    rec.current?.stop();
    const chat = archivos
      .filter((a) => a.tipo === "chat")
      .map((a) => a.texto ?? "")
      .join("\n\n");
    const adjuntos = archivos.filter((a) => a.data).map((a) => ({ data: a.data, mime: a.mime }));
    if (!texto.trim() && !chat && !adjuntos.length) {
      toast.error("Contale algo o mandale capturas o el chat");
      return;
    }
    setBusy(true);
    try {
      const r = await callApi<ResultadoPresupuestoIA>("/api/ia/presupuesto-ia", { texto, chat, adjuntos, actual });
      onResultado(r);
      setResultado({ resumen: r.resumen, faltantes: r.faltantes });
      toast.success("Listo: revisá el presupuesto y guardalo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no pudo armarlo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card to-card p-4 transition-colors",
        arrastrando && "border-2 border-dashed border-primary bg-primary/[0.08]"
      )}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        void agregar(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/25">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Armalo con IA</p>
          <p className="text-[11px] text-muted-foreground">
            Contale, dictale o pasale capturas, un PDF o el chat de WhatsApp exportado <b>con archivos</b> (así escucha los audios).
          </p>
        </div>
      </div>

      <div className="relative">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files ?? []);
            if (!files.length) return;
            e.preventDefault();
            void agregar(files);
          }}
          rows={3}
          maxLength={6000}
          placeholder="Ej.: Martín de Pizzería Don Tano quiere 4 videos por mes y una jornada extra para el lanzamiento de la carta nueva. Paga con factura."
          className="resize-none rounded-xl bg-background/80 pr-12"
        />
        <button
          type="button"
          onClick={dictar}
          className={cn(
            "absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full transition-colors",
            dictando ? "animate-pulse bg-red-500 text-white" : "bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary"
          )}
          title={dictando ? "Dejar de dictar" : "Dictar"}
          aria-label={dictando ? "Dejar de dictar" : "Dictar con el micrófono"}
        >
          {dictando ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
      </div>
      {dictando && <p className="mt-1 text-[11px] font-medium text-red-500">Te escucho… hablá tranquilo y tocá el micrófono para terminar.</p>}
      {progreso && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progreso}
        </p>
      )}

      {audiosFaltantes > audiosSueltos && (
        <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-2.5 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            <b>El chat tiene {audiosFaltantes} audio{audiosFaltantes === 1 ? "" : "s"} que no vinieron</b>, y ahí suele estar lo importante. Exportalo desde el celular con <b>“Incluir archivos”</b>, o descargá los audios y arrastralos acá (los escucho y los paso a texto).
          </p>
        </div>
      )}
      {archivos.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {archivos.map((a) => (
            <span key={a.id} className="group/a relative flex items-center gap-1.5 rounded-xl border bg-background/80 py-1 pl-1 pr-7 text-xs">
              {a.vista ? (
                <img src={a.vista} alt="" className="h-8 w-8 rounded-lg object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {a.tipo === "chat" ? <MessageCircle className="h-4 w-4" /> : a.tipo === "pdf" ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                </span>
              )}
              <span className="max-w-[10rem] truncate">{a.tipo === "chat" ? `Chat: ${a.nombre}` : a.nombre}</span>
              <button
                type="button"
                onClick={() => quitar(a.id)}
                className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Sacar"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,application/pdf,.pdf,.txt,text/plain,.zip,application/zip,audio/*,.opus,.ogg,.m4a"
        className="hidden"
        onChange={(e) => {
          void agregar(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => input.current?.click()} disabled={leyendo || busy}>
          {leyendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1.5 h-3.5 w-3.5" />}
          Capturas, PDF o chat
        </Button>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">o arrastralos acá · Ctrl+V para pegar capturas</span>
        <Button
          type="button"
          onClick={() => void armar()}
          disabled={busy || leyendo}
          className="rounded-full bg-gradient-to-r from-primary to-fuchsia-500 font-semibold shadow-md shadow-primary/25 sm:ml-auto"
        >
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
          {busy ? "Armando el presupuesto…" : "Armar el presupuesto"}
        </Button>
      </div>

      {resultado && (
        <div className="mt-3 space-y-1.5 rounded-xl bg-background/70 p-3 text-xs animate-in fade-in">
          {resultado.resumen && (
            <p className="flex gap-1.5">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {resultado.resumen}
            </p>
          )}
          {resultado.faltantes.map((f) => (
            <p key={f} className="flex gap-1.5 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {f}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
