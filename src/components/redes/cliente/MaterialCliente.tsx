import { useMemo, useState } from "react";
import { ChevronDown, Clapperboard, Download, Film, FolderOpen, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientMediaCarousel } from "@/components/media/ClientMediaCarousel";
import { EtapaBadge } from "@/components/redes/EtapaBadge";
import { useDriveConnection } from "@/hooks/use-drive-connection";
import { getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";
import { asset } from "@/lib/asset";
import { mesLabel } from "@/lib/redes/format";
import { versionFinal } from "@/lib/redes/piezas";
import { cn } from "@/lib/utils";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";
import type { PiezaIA, Video } from "@/lib/redes/types";

type Filtro = "todo" | "crudo" | "editado";

/** El video editado se le muestra al cliente recién cuando le llega para aprobar (igual que en la ficha del video). */
const EDITADO_VISIBLE: Video["etapa"][] = ["revision_cliente", "para_publicar", "publicado"];

interface Grupo {
  id: string;
  tipo: "video" | "pieza";
  titulo: string;
  mes: string;
  fecha: string;
  etapa?: Video["etapa"];
  crudo: DriveAttachmentRef[];
  editado: DriveAttachmentRef[];
}

const mesDe = (iso: string) => iso.slice(0, 7);

/** Todo el material de la marca: lo que filmamos (crudo) y lo terminado (videos editados y piezas entregadas). */
export function MaterialCliente({ videos, piezas }: { videos: Video[]; piezas: PiezaIA[] }) {
  const { connection } = useDriveConnection();
  const driveAvailable = connection?.status === "connected";
  const [filtro, setFiltro] = useState<Filtro>("todo");
  const [mes, setMes] = useState<string>("todos");

  const grupos = useMemo<Grupo[]>(() => {
    const deVideos: Grupo[] = videos.map((v) => ({
      id: v.id,
      tipo: "video",
      titulo: v.titulo,
      mes: v.mes,
      fecha: v.updated_at ?? v.created_at,
      etapa: v.etapa,
      crudo: v.attachments_crudo ?? [],
      editado: EDITADO_VISIBLE.includes(v.etapa) ? v.attachments_finalizado ?? [] : [],
    }));
    const dePiezas: Grupo[] = piezas
      .filter((p) => p.estado === "entregada")
      .flatMap((p) => {
        const f = versionFinal(p);
        if (!f) return [];
        const ref: DriveAttachmentRef = {
          drive_file_id: f.drive_file_id,
          name: f.name,
          mime_type: f.mime_type,
          size: 0,
          thumbnail_link: f.thumbnail_link,
          web_view_link: f.web_view_link ?? "",
          uploaded_at: f.created_at,
          uploaded_by: "",
          folder_path: "",
        };
        return [
          {
            id: p.id,
            tipo: "pieza" as const,
            titulo: p.producto || p.pedido,
            mes: p.mes ?? mesDe(p.created_at),
            fecha: p.updated_at ?? p.created_at,
            crudo: [],
            editado: [ref],
          },
        ];
      });
    return [...deVideos, ...dePiezas]
      .filter((g) => g.crudo.length + g.editado.length > 0)
      .sort((a, b) => b.mes.localeCompare(a.mes) || b.fecha.localeCompare(a.fecha));
  }, [videos, piezas]);

  const meses = useMemo(() => [...new Set(grupos.map((g) => g.mes))].sort().reverse(), [grupos]);
  const visibles = grupos
    .filter((g) => mes === "todos" || g.mes === mes)
    .filter((g) => (filtro === "crudo" ? g.crudo.length > 0 : filtro === "editado" ? g.editado.length > 0 : true));

  const total = (k: "crudo" | "editado") => grupos.reduce((n, g) => n + g[k].length, 0);

  if (grupos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-6 text-center">
        <FolderOpen className="mx-auto h-8 w-8 text-primary/60" />
        <p className="mt-2 font-semibold">Todavía no hay material</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Cuando filmemos, acá vas a ver todo lo que grabamos. Y cuando tus videos y piezas estén listos, también los vas a encontrar acá.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-full rounded-xl border bg-muted/40 p-1 sm:w-auto" role="tablist" aria-label="Tipo de material">
          {(
            [
              { v: "todo", label: "Todo" },
              { v: "crudo", label: `Crudo (${total("crudo")})` },
              { v: "editado", label: `Editado (${total("editado")})` },
            ] as { v: Filtro; label: string }[]
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              role="tab"
              aria-selected={filtro === o.v}
              onClick={() => setFiltro(o.v)}
              className={cn(
                "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all sm:flex-none",
                filtro === o.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los meses</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m}>
                {mesLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">No hay material con este filtro.</p>
      ) : (
        <div className="space-y-3">
          {visibles.map((g) => (
            <GrupoMaterial key={`${g.tipo}-${g.id}`} grupo={g} filtro={filtro} driveAvailable={driveAvailable} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        El material crudo es lo que filmamos tal cual salió de la cámara. Los videos editados aparecen cuando te llegan para aprobar.
      </p>
    </div>
  );
}

function GrupoMaterial({ grupo, filtro, driveAvailable }: { grupo: Grupo; filtro: Filtro; driveAvailable: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const verCrudo = filtro !== "editado" && grupo.crudo.length > 0;
  const verEditado = filtro !== "crudo" && grupo.editado.length > 0;
  const Icono = grupo.tipo === "pieza" ? ImageIcon : Film;

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-3 p-3.5 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icono className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{grupo.titulo}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{grupo.tipo === "pieza" ? "Pieza gráfica" : "Video"} · {mesLabel(grupo.mes)}</span>
            {grupo.crudo.length > 0 && <span>{grupo.crudo.length} crudo{grupo.crudo.length === 1 ? "" : "s"}</span>}
            {grupo.editado.length > 0 && <span>{grupo.editado.length} editado{grupo.editado.length === 1 ? "" : "s"}</span>}
          </span>
        </span>
        {grupo.etapa && <EtapaBadge etapa={grupo.etapa} vista="cliente" className="hidden sm:inline-flex" />}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
      </button>
      {/* Se arma recién al abrir: así no se cargan todas las miniaturas de golpe. */}
      {abierto && (
        <div className="space-y-5 border-t p-3.5">
          {verEditado && (
            <SeccionArchivos
              icon={grupo.tipo === "pieza" ? ImageIcon : Film}
              titulo={grupo.tipo === "pieza" ? "Pieza final" : "Editado"}
              archivos={grupo.editado}
              driveAvailable={driveAvailable}
            />
          )}
          {verCrudo && (
            <SeccionArchivos icon={Clapperboard} titulo="Material crudo" archivos={grupo.crudo} driveAvailable={driveAvailable} />
          )}
        </div>
      )}
    </div>
  );
}

function SeccionArchivos({
  icon: Icon,
  titulo,
  archivos,
  driveAvailable,
}: {
  icon: React.ElementType;
  titulo: string;
  archivos: DriveAttachmentRef[];
  driveAvailable: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {titulo}
      </p>
      <ClientMediaCarousel attachments={archivos} driveAvailable={driveAvailable} />
      {driveAvailable && <Descargas archivos={archivos} />}
    </div>
  );
}

/**
 * Descarga con el mismo permiso corto que usa el reproductor (/api/drive/media-token):
 * ni la sesión ni el acceso a Drive viajan en la URL.
 */
async function descargar(a: DriveAttachmentRef) {
  const url = a.drive_file_id.startsWith("demo/") ? asset(a.drive_file_id) : await getDriveMediaPlayUrl(a.drive_file_id);
  const link = document.createElement("a");
  link.href = url;
  link.download = a.name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function Descargas({ archivos }: { archivos: DriveAttachmentRef[] }) {
  const [bajando, setBajando] = useState<string | null>(null);
  const bajar = async (a: DriveAttachmentRef) => {
    setBajando(a.drive_file_id);
    try {
      await descargar(a);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descargar");
    } finally {
      setBajando(null);
    }
  };
  return (
    <ul className="divide-y rounded-xl border">
      {archivos.map((a) => (
        <li key={a.drive_file_id} className="flex items-center gap-2 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs">{a.name}</span>
          {a.size > 0 && <span className="shrink-0 text-[11px] text-muted-foreground">{peso(a.size)}</span>}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 shrink-0 px-2 text-xs"
            disabled={bajando === a.drive_file_id}
            onClick={() => void bajar(a)}
            aria-label={`Descargar ${a.name}`}
          >
            {bajando === a.drive_file_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span className="ml-1 hidden sm:inline">Descargar</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function peso(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
