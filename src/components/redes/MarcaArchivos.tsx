import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, ImagePlus, Loader2, MoreVertical, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { DriveAttachmentRef, LogoVariante, Project } from "@/integrations/firebase/types";
import { callApi, imagenParaSubir } from "@/lib/redes/api";
import { asegurarAvatar, guardarAvatar } from "@/lib/redes/avatarLogo";
import { cn } from "@/lib/utils";
import { driveThumb } from "./PiezaDialogs";

/** Fondo a cuadros: así se ven los logos blancos o sin fondo. */
const CUADROS: React.CSSProperties = {
  backgroundImage: "repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%)",
  backgroundSize: "14px 14px",
};
const verEnDrive = (id: string) => `https://drive.google.com/file/d/${id}/view`;

/** Etiqueta a partir del nombre del archivo ("logo-blanco.png" → "Blanco"). */
export function etiquetaDesdeNombre(nombre: string): string {
  const n = nombre.toLowerCase();
  const pistas: [RegExp, string][] = [
    [/blanc|white|negativ/, "Blanco (fondos oscuros)"],
    [/negr|black|mono/, "Negro"],
    [/horizontal/, "Horizontal"],
    [/vertical/, "Vertical"],
    [/isotipo|icono|icon|simbolo|símbolo/, "Isotipo"],
    [/marca.?de.?agua|mda|watermark/, "Marca de agua"],
    [/color/, "Color"],
    [/sin.?fondo|transparente|png/, "Sin fondo"],
  ];
  return pistas.find(([re]) => re.test(n))?.[1] ?? nombre.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 60);
}

/** El PDF (o imagen) tal cual, en base64, para los manuales de marca. */
async function archivoParaSubir(file: File): Promise<{ data: string; mime: string; nombre: string }> {
  if (file.type.startsWith("image/")) return imagenParaSubir(file, 2400);
  if (file.size > 3 * 1024 * 1024) throw new Error("El PDF pesa más de 3 MB");
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { data: btoa(bin), mime: "application/pdf", nombre: file.name };
}

/**
 * Identidad de la marca: logo principal, sus otras versiones, manual y colores.
 * La IA, las diseñadoras y todo el equipo lo usan para que las piezas salgan con la identidad del cliente.
 */
export function MarcaArchivos({ cliente, className }: { cliente: Project; className?: string }) {
  const logo = cliente.marca_archivos?.logo ?? null;
  const variantes = cliente.marca_archivos?.variantes ?? [];
  const manuales = cliente.marca_archivos?.manuales ?? [];
  const [subiendo, setSubiendo] = useState<null | "logo" | "variante" | "manual">(null);
  const inputLogo = useRef<HTMLInputElement>(null);
  const inputVariante = useRef<HTMLInputElement>(null);
  const inputManual = useRef<HTMLInputElement>(null);

  // Foto de perfil (logo centrado) si falta o es de un logo anterior (ej. cuando una versión pasa a ser la principal).
  useEffect(() => {
    void asegurarAvatar(cliente);
  }, [cliente]);

  const subir = async (tipo: "logo" | "variante" | "manual", files: File[]) => {
    if (!files.length) return;
    setSubiendo(tipo);
    let ok = 0;
    try {
      for (const file of files) {
        if (tipo !== "manual" && !file.type.startsWith("image/")) {
          toast.error(`${file.name}: elegí una imagen (PNG, JPG o WEBP)`);
          continue;
        }
        try {
          const arch = tipo === "manual" ? await archivoParaSubir(file) : await imagenParaSubir(file, 2000);
          const r = await callApi<{ archivo?: { drive_file_id: string } }>("/api/ia/marca-subir", {
            proyecto_id: cliente.id,
            tipo,
            ...(tipo === "variante" ? { etiqueta: etiquetaDesdeNombre(file.name) } : {}),
            ...arch,
          });
          ok++;
          if (tipo === "logo" && r.archivo?.drive_file_id) {
            await guardarAvatar(cliente.id, r.archivo.drive_file_id, file).catch((err) => console.warn("[marca] foto de perfil", err));
          }
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : "no se pudo subir"}`);
        }
      }
      if (ok) toast.success(tipo === "logo" ? "Logo cargado" : tipo === "manual" ? "Manual cargado" : ok === 1 ? "Versión del logo cargada" : `${ok} versiones del logo cargadas`);
    } finally {
      setSubiendo(null);
      for (const r of [inputLogo, inputVariante, inputManual]) if (r.current) r.current.value = "";
    }
  };

  const quitar = async (tipo: "logo" | "variante" | "manual", a: DriveAttachmentRef) => {
    try {
      await callApi("/api/ia/marca-quitar", { proyecto_id: cliente.id, tipo, drive_file_id: a.drive_file_id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo quitar");
    }
  };

  const cambiarVariante = async (v: LogoVariante, cambios: { etiqueta?: string; principal?: boolean }) => {
    try {
      await callApi("/api/ia/marca-variante", { proyecto_id: cliente.id, drive_file_id: v.drive_file_id, ...cambios });
      if (cambios.principal) toast.success("Ahora es el logo principal");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar");
    }
  };

  return (
    <div className={cn("space-y-5", className)}>
      <div className="grid grid-cols-[96px_1fr] gap-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Logo principal</p>
          <Slot
            att={logo}
            vacio="Subir logo"
            busy={subiendo === "logo"}
            onAdd={() => inputLogo.current?.click()}
            onRemove={logo ? () => quitar("logo", logo) : undefined}
          />
          <input ref={inputLogo} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => subir("logo", [...(e.target.files ?? [])].slice(0, 1))} />
        </div>
        <PaletaMarca cliente={cliente} conNombres />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium">Otras versiones del logo</p>
            <p className="text-[11px] text-muted-foreground">Blanco, negro, horizontal, isotipo, marca de agua… Ponele a cada una para qué sirve.</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => inputVariante.current?.click()} disabled={!!subiendo || variantes.length >= 30}>
            {subiendo === "variante" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />} Agregar
          </Button>
          <input
            ref={inputVariante}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => subir("variante", [...(e.target.files ?? [])].slice(0, 30 - variantes.length))}
          />
        </div>
        {variantes.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {variantes.map((v) => (
              <Variante
                key={v.drive_file_id}
                v={v}
                onRenombrar={(etiqueta) => void cambiarVariante(v, { etiqueta })}
                onPrincipal={() => void cambiarVariante(v, { principal: true })}
                onQuitar={() => void quitar("variante", v)}
              />
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputVariante.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-4 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <ImagePlus className="h-4 w-4" /> Subí todas las versiones juntas
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium">Manual de marca</p>
            <p className="text-[11px] text-muted-foreground">Brandboard, guía de identidad o de uso del logo (PDF o imagen).</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => inputManual.current?.click()} disabled={!!subiendo || manuales.length >= 8}>
            {subiendo === "manual" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />} Agregar
          </Button>
          <input
            ref={inputManual}
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => subir("manual", [...(e.target.files ?? [])].slice(0, 8 - manuales.length))}
          />
        </div>
        {manuales.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {manuales.map((m) => (
              <li key={m.drive_file_id} className="flex items-center gap-2.5 px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <a href={verEnDrive(m.drive_file_id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
                  {m.name}
                </a>
                <a href={verEnDrive(m.drive_file_id)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Abrir">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button type="button" onClick={() => void quitar("manual", m)} className="text-muted-foreground hover:text-destructive" aria-label="Quitar">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Variante({ v, onRenombrar, onPrincipal, onQuitar }: { v: LogoVariante; onRenombrar: (e: string) => void; onPrincipal: () => void; onQuitar: () => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(v.etiqueta);
  const guardar = () => {
    setEditando(false);
    const t = texto.trim();
    if (t && t !== v.etiqueta) onRenombrar(t);
    else setTexto(v.etiqueta);
  };
  return (
    <div className="min-w-0 space-y-1">
      <div className="group relative aspect-square overflow-hidden rounded-lg border" style={CUADROS}>
        <a href={verEnDrive(v.drive_file_id)} target="_blank" rel="noreferrer" title="Abrir en tamaño original">
          <img src={driveThumb(v.drive_file_id, 300)} alt={v.etiqueta} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain p-1.5" />
        </a>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-80 hover:opacity-100"
              aria-label="Opciones"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditando(true)}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Cambiar el nombre
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPrincipal}>
              <Star className="mr-2 h-3.5 w-3.5" /> Usar como logo principal
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={verEnDrive(v.drive_file_id)} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-3.5 w-3.5" /> Abrir / descargar
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onQuitar} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Quitar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editando ? (
        <Input
          autoFocus
          value={texto}
          maxLength={60}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={guardar}
          onKeyDown={(e) => {
            if (e.key === "Enter") guardar();
            if (e.key === "Escape") {
              setTexto(v.etiqueta);
              setEditando(false);
            }
          }}
          className="h-7 px-1.5 text-[11px]"
        />
      ) : (
        <button type="button" onClick={() => setEditando(true)} className="block w-full truncate text-left text-[11px] text-muted-foreground hover:text-foreground" title={v.etiqueta}>
          {v.etiqueta}
        </button>
      )}
    </div>
  );
}

const SUGERIDOS = ["#111111", "#ffffff", "#f97316", "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];
type InfoColor = { nombre?: string; uso?: string };

/** Colores de la marca: el primero es el principal; se pueden sumar los que quiera (y, en la ficha, ponerles nombre y uso). */
export function PaletaMarca({ cliente, conNombres = false }: { cliente: Project; conNombres?: boolean }) {
  const guardada = cliente.marca?.paleta ?? [];
  const infoGuardada = cliente.marca?.colores_info ?? {};
  const [paleta, setPaleta] = useState<string[]>(guardada);
  const [info, setInfo] = useState<Record<string, InfoColor>>(infoGuardada);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const clave = JSON.stringify([cliente.marca?.paleta ?? [], cliente.marca?.colores_info ?? {}]);
  useEffect(() => {
    if (!dirty) {
      setPaleta(cliente.marca?.paleta ?? []);
      setInfo(cliente.marca?.colores_info ?? {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  const cambiar = (n: string[]) => {
    setPaleta(n);
    setDirty(true);
  };
  /** Al cambiar un color de lugar o de tono, su nombre y uso lo siguen. */
  const cambiarColor = (i: number, hex: string) => {
    const viejo = paleta[i];
    cambiar(paleta.map((x, j) => (j === i ? hex : x)));
    if (info[viejo]) setInfo(({ [viejo]: d, ...resto }) => ({ ...resto, [hex]: d }));
  };
  const cambiarInfo = (hex: string, campo: keyof InfoColor, valor: string) => {
    setInfo((x) => ({ ...x, [hex]: { ...x[hex], [campo]: valor } }));
    setDirty(true);
  };
  const guardar = async () => {
    setBusy(true);
    try {
      await callApi("/api/ia/marca-colores", { proyecto_id: cliente.id, paleta, ...(conNombres ? { info } : {}) });
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
      <p className="text-xs font-medium">Colores de la marca</p>
      <div className="flex flex-wrap items-center gap-2">
        {paleta.map((c, i) => (
          <div key={i} className="group relative">
            <label
              className={cn(
                "flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl border-2 shadow-sm transition-transform hover:scale-105",
                i === 0 ? "border-primary" : "border-border"
              )}
              style={{ background: c }}
              title={[i === 0 ? "Principal" : "", info[c]?.nombre, c].filter(Boolean).join(" · ")}
            >
              <input
                type="color"
                value={c}
                aria-label={i === 0 ? "Color principal" : `Color ${i + 1}`}
                onChange={(e) => cambiarColor(i, e.target.value)}
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
      {conNombres && paleta.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {paleta.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="h-5 w-5 shrink-0 rounded-md border" style={{ background: c }} />
              <code className="w-[4.5rem] shrink-0 text-[11px] text-muted-foreground">{c}</code>
              <Input
                value={info[c]?.nombre ?? ""}
                onChange={(e) => cambiarInfo(c, "nombre", e.target.value)}
                placeholder={i === 0 ? "Nombre (ej. Verde Maurenzi)" : "Nombre"}
                maxLength={40}
                className="h-7 min-w-0 flex-1 text-xs"
              />
              <Input
                value={info[c]?.uso ?? ""}
                onChange={(e) => cambiarInfo(c, "uso", e.target.value)}
                placeholder="Para qué se usa"
                maxLength={80}
                className="h-7 min-w-0 flex-[1.4] text-xs max-sm:hidden"
              />
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {paleta.length ? "Tocá un color para cambiarlo. El primero (con borde) es el principal." : "Sumá los colores de la marca: tocá + y elegilo."}
      </p>
      {dirty && (
        <Button size="sm" className="h-8" onClick={() => void guardar()} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Guardar colores
        </Button>
      )}
    </div>
  );
}

function Slot({ att, vacio, busy, onAdd, onRemove }: { att?: DriveAttachmentRef | null; vacio?: string; busy?: boolean; onAdd?: () => void; onRemove?: () => void }) {
  if (att) {
    return (
      <div className="group relative aspect-square overflow-hidden rounded-lg border" style={CUADROS}>
        <img src={driveThumb(att.drive_file_id, 300)} alt={att.name} referrerPolicy="no-referrer" className="h-full w-full object-contain p-1.5" />
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
