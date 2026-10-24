import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Film, Image as ImageIcon, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useRedes } from "@/contexts/redes-data-context";
import { borrarDeGaleria, linkParaMandar, subirGaleria, useGaleria, type ArchivoGaleria } from "@/lib/redes/crmGaleria";
import { versionFinal } from "@/lib/redes/piezas";
import { getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";
import { cn } from "@/lib/utils";

// Panel del chat del CRM para mandarle a un contacto fotos o videos: los que hizo Prodi (videos terminados y piezas)
// o los propios que sube el cliente. Al elegir uno se arma su link y se suma al mensaje.

interface Item {
  key: string;
  fileId: string;
  titulo: string;
  mime: string;
  propio?: ArchivoGaleria;
}

/** El video terminado se muestra recién cuando le llegó al cliente (como en Material). */
const VIDEO_LISTO = ["revision_cliente", "para_publicar", "publicado"];

function Miniatura({ fileId, mime }: { fileId: string; mime: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  // Se pide recién cuando se ve (no todas juntas).
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      getDriveMediaPlayUrl(fileId)
        .then(setSrc)
        .catch(() => undefined);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [fileId]);
  const video = mime.startsWith("video/");
  return (
    <div ref={caja} className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
      {src && (video ? <video src={`${src}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" /> : <img src={src} alt="" className="h-full w-full object-cover" />)}
      {!src && <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">{video ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}</span>}
      {video && src && (
        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] font-semibold text-white">
          <Film className="h-2.5 w-2.5" /> Video
        </span>
      )}
    </div>
  );
}

export function GaleriaChat({ proyectoId, onElegir, onCerrar }: { proyectoId: string; onElegir: (texto: string) => void; onCerrar: () => void }) {
  const { videos, piezas } = useRedes();
  const propios = useGaleria(proyectoId);
  const [pestana, setPestana] = useState<"prodi" | "propios">("prodi");
  const [armando, setArmando] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState<{ nombre: string; pct: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const deProdi: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const v of videos) {
      if (v.proyecto_id !== proyectoId || !VIDEO_LISTO.includes(v.etapa)) continue;
      for (const a of v.attachments_finalizado ?? []) if (a.mime_type.startsWith("video/")) out.push({ key: `v-${a.drive_file_id}`, fileId: a.drive_file_id, titulo: v.titulo, mime: a.mime_type });
    }
    for (const p of piezas) {
      if (p.proyecto_id !== proyectoId) continue;
      const f = versionFinal(p);
      const titulo = p.producto || p.texto_en_pieza || "Pieza";
      if (f) out.push({ key: `p-${f.drive_file_id}`, fileId: f.drive_file_id, titulo, mime: f.mime_type });
      for (const a of p.attachments_finalizado ?? []) if (a.mime_type.startsWith("image/")) out.push({ key: `p-${a.drive_file_id}`, fileId: a.drive_file_id, titulo, mime: a.mime_type });
    }
    return out;
  }, [videos, piezas, proyectoId]);
  const tuyos: Item[] = (propios ?? []).map((a) => ({ key: a.id, fileId: a.archivo.drive_file_id, titulo: a.titulo, mime: a.archivo.mime_type, propio: a }));
  const lista = pestana === "prodi" ? deProdi : tuyos;

  const elegir = async (it: Item) => {
    setArmando(it.key);
    try {
      const url = await linkParaMandar(proyectoId, it.fileId);
      onElegir(`${it.titulo}: ${url}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo armar el link");
    } finally {
      setArmando(null);
    }
  };

  const subir = async (files: File[]) => {
    if (!files.length) return;
    setPestana("propios");
    setSubiendo({ nombre: files[0].name, pct: 0 });
    await subirGaleria(proyectoId, files, (nombre, pct) => setSubiendo({ nombre, pct }));
    setSubiendo(null);
  };

  return (
    <div className="border-t bg-muted/40 p-2">
      <div className="mb-2 flex items-center gap-2 px-1">
        {/* Selector segmentado: el activo con el degradé de la marca. */}
        <div className="inline-flex rounded-full border bg-background p-0.5 shadow-sm">
          {(
            [
              ["prodi", "Hechos por Prodi", Clapperboard, deProdi.length],
              ["propios", "Tuyos", ImageIcon, tuyos.length],
            ] as const
          ).map(([k, label, I, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => setPestana(k)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-all duration-200",
                pestana === k ? "bg-gradient-to-r from-primary to-fuchsia-500 text-white shadow-md shadow-primary/25" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <I className="h-3.5 w-3.5" /> {label}
              <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", pestana === k ? "bg-white/20" : "bg-muted")}>{n}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onCerrar} className="ml-auto rounded-md p-0.5 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
        {pestana === "propios" && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!subiendo}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-background text-center text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            {subiendo ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> {Math.round(subiendo.pct)}%
              </>
            ) : (
              <>
                <Plus className="h-5 w-5" /> Subir fotos o videos
              </>
            )}
          </button>
        )}
        {lista.map((it) => (
          <div key={it.key} className="group relative">
            <button type="button" onClick={() => void elegir(it)} disabled={!!armando} className="block w-full text-left" title={`Mandar “${it.titulo}”`}>
              <Miniatura fileId={it.fileId} mime={it.mime} />
              <span className="mt-1 block truncate text-[11px] font-medium">{it.titulo}</span>
              {armando === it.key && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </span>
              )}
            </button>
            {it.propio && (
              <button
                type="button"
                onClick={() => window.confirm(`¿Sacar “${it.titulo}” de tu galería?`) && void borrarDeGaleria(it.propio!)}
                className="absolute right-1 top-1 hidden rounded-md bg-black/60 p-1 text-white group-hover:block"
                aria-label="Sacar de la galería"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      {lista.length === 0 && pestana === "prodi" && <p className="px-1 py-6 text-center text-xs text-muted-foreground">Todavía no hay videos ni piezas terminadas.</p>}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.mov"
        multiple
        hidden
        onChange={(e) => {
          void subir(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
