import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { DriveAttachmentRef, Project } from "@/integrations/firebase/types";
import { callApi, imagenParaSubir } from "@/lib/redes/api";
import { cn } from "@/lib/utils";
import { driveThumb } from "./PiezaDialogs";

/**
 * Logo y colores de la marca. La IA y la diseñadora los usan para que las piezas
 * salgan con la identidad del cliente.
 */
export function MarcaArchivos({ cliente, className }: { cliente: Project; className?: string }) {
  const logo = cliente.marca_archivos?.logo ?? null;
  const [subiendo, setSubiendo] = useState(false);
  const inputLogo = useRef<HTMLInputElement>(null);

  const subir = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Elegí una imagen (PNG o JPG)");
      return;
    }
    setSubiendo(true);
    try {
      const img = await imagenParaSubir(file);
      await callApi("/api/ia/marca-subir", { proyecto_id: cliente.id, tipo: "logo", ...img });
      toast.success("Logo cargado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo subir");
    } finally {
      setSubiendo(false);
      if (inputLogo.current) inputLogo.current.value = "";
    }
  };

  const quitar = async (a: DriveAttachmentRef) => {
    try {
      await callApi("/api/ia/marca-quitar", { proyecto_id: cliente.id, tipo: "logo", drive_file_id: a.drive_file_id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo quitar");
    }
  };

  return (
    <div className={cn("grid grid-cols-[96px_1fr] gap-4", className)}>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Logo</p>
        <Slot att={logo} vacio="Subir logo" busy={subiendo} onAdd={() => inputLogo.current?.click()} onRemove={logo ? () => quitar(logo) : undefined} contain />
        <input ref={inputLogo} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => subir(e.target.files?.[0])} />
      </div>
      <PaletaMarca cliente={cliente} />
    </div>
  );
}

const SUGERIDOS = ["#111111", "#ffffff", "#f97316", "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];

/** Colores de la marca: el primero es el principal; se pueden sumar los que quiera. */
export function PaletaMarca({ cliente }: { cliente: Project }) {
  const guardada = cliente.marca?.paleta ?? [];
  const [paleta, setPaleta] = useState<string[]>(guardada);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!dirty) setPaleta(cliente.marca?.paleta ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(cliente.marca?.paleta ?? []).join(",")]);
  const cambiar = (n: string[]) => {
    setPaleta(n);
    setDirty(true);
  };
  const guardar = async () => {
    setBusy(true);
    try {
      await callApi("/api/ia/marca-colores", { proyecto_id: cliente.id, paleta });
      setDirty(false);
      toast.success("Colores guardados");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };
  const sumar = () => cambiar([...paleta, SUGERIDOS.find((c) => !paleta.includes(c)) ?? "#888888"]);
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium">Colores de tu marca</p>
      <div className="flex flex-wrap items-center gap-2">
        {paleta.map((c, i) => (
          <div key={i} className="group relative">
            <label
              className={cn(
                "flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl border-2 shadow-sm transition-transform hover:scale-105",
                i === 0 ? "border-primary" : "border-border"
              )}
              style={{ background: c }}
              title={i === 0 ? `Principal · ${c}` : c}
            >
              <input
                type="color"
                value={c}
                aria-label={i === 0 ? "Color principal" : `Color ${i + 1}`}
                onChange={(e) => cambiar(paleta.map((x, j) => (j === i ? e.target.value : x)))}
                className="sr-only"
              />
            </label>
            <button
              type="button"
              onClick={() => cambiar(paleta.filter((_, j) => j !== i))}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 max-md:opacity-90"
              aria-label="Quitar color"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={sumar}
          disabled={paleta.length >= 12}
          className="flex h-12 w-12 flex-col items-center justify-center rounded-xl border border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          aria-label="Agregar color"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {paleta.length ? "Tocá un color para cambiarlo. El primero (con borde) es el principal." : "Sumá los colores de tu marca: tocá + y elegilo."}
      </p>
      {dirty && (
        <Button size="sm" className="h-8" onClick={() => void guardar()} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Guardar colores
        </Button>
      )}
    </div>
  );
}

function Slot({
  att,
  vacio,
  busy,
  onAdd,
  onRemove,
  contain,
}: {
  att?: DriveAttachmentRef | null;
  vacio?: string;
  busy?: boolean;
  onAdd?: () => void;
  onRemove?: () => void;
  contain?: boolean;
}) {
  if (att) {
    return (
      <div className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
        <img
          src={driveThumb(att.drive_file_id, 300)}
          alt={att.name}
          referrerPolicy="no-referrer"
          className={cn("h-full w-full", contain ? "object-contain p-1.5" : "object-cover")}
        />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-80 hover:opacity-100"
            aria-label="Quitar"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={busy}
      className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
      {vacio}
    </button>
  );
}
