import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Adjuntar fotos, capturas y PDF a las charlas con la IA (Armar el mes, Campaña con IA…). Las fotos se achican a JPEG
// antes de mandarlas (así entran varias en un pedido) y los PDF van tal cual. Se puede tocar el clip, pegar una captura
// en el cuadro de texto o arrastrar los archivos.

export interface AdjuntoIA {
  nombre: string;
  mime: string;
  data: string;
}

const TIPOS = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;
const MAX_ARCHIVOS = 6;
/** Lo que entra en un pedido (Vercel corta en 4,5 MB y el base64 suma un tercio). */
const MAX_BYTES = 3_000_000;

function aBase64(b: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => mal(r.error);
    r.readAsDataURL(b);
  });
}

/** Fotos y capturas: a JPEG de 1600 px como mucho (la IA las lee igual de bien y pesan 10 veces menos). */
async function achicar(f: File): Promise<Blob> {
  if (f.type === "application/pdf" || f.type === "image/gif") return f;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < f.size ? blob : f;
  } catch {
    return f;
  }
}

export function useAdjuntosIA() {
  const [archivos, setArchivos] = useState<File[]>([]);
  const vistas = useRef(new Map<File, string>());

  useEffect(
    () => () => {
      vistas.current.forEach((u) => URL.revokeObjectURL(u));
    },
    []
  );

  const sumar = (lista: FileList | File[] | null | undefined) => {
    const nuevos = [...(lista ?? [])].filter((f) => TIPOS.test(f.type));
    if (!nuevos.length) {
      if (lista && [...lista].length) toast.error("Se pueden mandar fotos, capturas o PDF");
      return;
    }
    setArchivos((prev) => {
      const todos = [...prev, ...nuevos];
      if (todos.length > MAX_ARCHIVOS) toast.message(`Hasta ${MAX_ARCHIVOS} archivos por mensaje`);
      return todos.slice(0, MAX_ARCHIVOS);
    });
  };

  const quitar = (f: File) => setArchivos((prev) => prev.filter((x) => x !== f));
  const vista = (f: File) => {
    if (!f.type.startsWith("image/")) return null;
    let u = vistas.current.get(f);
    if (!u) {
      u = URL.createObjectURL(f);
      vistas.current.set(f, u);
    }
    return u;
  };

  /** Los deja listos para mandar (y vacía la lista). Tira error si pesan demasiado. */
  const preparar = async (): Promise<AdjuntoIA[]> => {
    if (!archivos.length) return [];
    const listos = await Promise.all(archivos.map(async (f) => ({ f, b: await achicar(f) })));
    const total = listos.reduce((n, x) => n + x.b.size, 0);
    if (total > MAX_BYTES) throw new Error("Los archivos pesan mucho: mandá menos o PDF más livianos (hasta 3 MB por mensaje)");
    const out = await Promise.all(listos.map(async ({ f, b }) => ({ nombre: f.name || "captura", mime: b.type || f.type, data: await aBase64(b) })));
    setArchivos([]);
    return out;
  };

  /** Para el cuadro de texto: pegar una captura la adjunta. */
  const alPegar = (e: React.ClipboardEvent) => {
    const fs = [...e.clipboardData.files];
    if (fs.length) {
      e.preventDefault();
      sumar(fs);
    }
  };
  /** Para la caja de la charla: soltar archivos los adjunta. */
  const alSoltar = {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      sumar(e.dataTransfer.files);
    },
  };

  return { archivos, sumar, quitar, vista, preparar, alPegar, alSoltar, lleno: archivos.length >= MAX_ARCHIVOS };
}

type Adjuntos = ReturnType<typeof useAdjuntosIA>;

/** Botón del clip (abre el selector de archivos). */
export function BotonAdjuntar({ adj, className, disabled }: { adj: Adjuntos; className?: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          adj.sumar(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || adj.lleno}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40",
          className
        )}
        aria-label="Adjuntar fotos o PDF"
        title="Adjuntar fotos, capturas o PDF (también podés pegar una captura)"
      >
        <Paperclip className="h-4 w-4" />
      </button>
    </>
  );
}

/** Los archivos elegidos, con miniatura y para sacarlos. */
export function ListaAdjuntos({ adj, className }: { adj: Adjuntos; className?: string }) {
  if (!adj.archivos.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {adj.archivos.map((f, i) => {
        const u = adj.vista(f);
        return (
          <div key={i} className="group relative flex h-12 items-center gap-1.5 overflow-hidden rounded-xl border bg-muted/50 pr-6 text-[11px]">
            {u ? (
              <img src={u} alt="" className="h-12 w-12 object-cover" />
            ) : (
              <span className="flex h-12 w-10 items-center justify-center bg-red-500/10 text-red-600">
                <FileText className="h-4 w-4" />
              </span>
            )}
            {!u && <span className="max-w-[8rem] truncate">{f.name}</span>}
            <button
              type="button"
              onClick={() => adj.quitar(f)}
              className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 text-muted-foreground shadow-sm hover:text-foreground"
              aria-label="Sacar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Debajo de un mensaje mandado: qué archivos iban. */
export function AdjuntosEnviados({ nombres, claro }: { nombres?: string[]; claro?: boolean }) {
  if (!nombres?.length) return null;
  return (
    <p className={cn("mt-1 flex items-center gap-1 text-[10px]", claro ? "text-white/80" : "text-muted-foreground")}>
      <Paperclip className="h-3 w-3" /> {nombres.length === 1 ? nombres[0] : `${nombres.length} archivos`}
    </p>
  );
}
