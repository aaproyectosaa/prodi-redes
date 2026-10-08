import { ExternalLink, FolderOpen, History } from "lucide-react";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";

/** Datos que trajo una tarea de los sistemas anteriores (progreso / postgo). */
export interface DatosViejos {
  material_crudo?: string | null;
  material_finalizado?: string | null;
  attachments_crudo?: DriveAttachmentRef[];
}

const esUrl = (s: unknown): s is string => typeof s === "string" && /^https?:\/\//.test(s.trim());
const origenLabel = (o?: string) => (o === "postgo" ? "PostGo" : o === "progreso" ? "el sistema anterior" : "el sistema anterior");

/** Texto con los links clickeables. */
export function TextoConLinks({ texto }: { texto: string }) {
  const partes = texto.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words">
      {partes.map((p, i) =>
        esUrl(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {/\/folders\//.test(p) ? "carpeta de Drive" : "link"}
          </a>
        ) : (
          p
        )
      )}
    </p>
  );
}

function Link({ href, titulo }: { href: string; titulo: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2 transition-colors hover:border-primary/50">
      <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate">{titulo}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

/**
 * Lo que vino del sistema anterior y no tiene lugar propio en el nuevo: notas del equipo, material crudo
 * y final (que allá eran links a carpetas de Drive) y los archivos crudos adjuntos.
 */
export function DelSistemaAnterior({ origen, viejo, nota }: { origen?: string; viejo?: DatosViejos | null; nota?: string | null }) {
  const crudo = esUrl(viejo?.material_crudo) ? viejo.material_crudo.trim() : null;
  const final = esUrl(viejo?.material_finalizado) ? viejo.material_finalizado.trim() : null;
  const adjuntos = viejo?.attachments_crudo ?? [];
  // Los links de material ya van como botón: no se repiten en la nota.
  nota = (nota ?? "")
    .split("\n")
    .filter((l) => !/^Material (crudo|final): https?:\/\//.test(l.trim()))
    .join("\n")
    .trim();
  if (!origen || !(crudo || final || adjuntos.length || nota)) return null;
  return (
    <div className="space-y-2 rounded-xl border border-dashed p-3 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Cargado en {origenLabel(origen)}
      </p>
      {nota?.trim() && (
        <div className="text-xs text-muted-foreground">
          <TextoConLinks texto={nota.trim()} />
        </div>
      )}
      {crudo && <Link href={crudo} titulo="Material crudo (carpeta de Drive)" />}
      {final && <Link href={final} titulo="Material final (carpeta de Drive)" />}
      {adjuntos.map((a) => (
        <Link key={a.drive_file_id} href={a.web_view_link || `https://drive.google.com/file/d/${a.drive_file_id}/view`} titulo={`Crudo: ${a.name}`} />
      ))}
    </div>
  );
}
