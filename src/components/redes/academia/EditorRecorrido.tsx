import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { guardarRecorrido, type LeccionRecorrido, type ModuloRecorrido, type PreguntaRecorrido, type Recorrido } from "@/lib/redes/academiaRecorrido";
import { cn } from "@/lib/utils";

// Admin: editar el contenido de un recorrido (semanas, lecciones, ejercicios, repasos, examen y glosario).
// Las listas se escriben una por línea. Se guarda todo junto en academia_recorridos/{id}.

const lineas = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "leccion";

function Campo({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Lista de textos, una por línea (guarda el texto tal cual mientras se escribe). */
function Lista({ label, valor, onCambio, rows = 3 }: { label: string; valor: string[]; onCambio: (v: string[]) => void; rows?: number }) {
  const [texto, setTexto] = useState(valor.join("\n"));
  return (
    <Campo label={`${label} (una por línea)`}>
      <Textarea value={texto} rows={rows} onChange={(e) => setTexto(e.target.value)} onBlur={() => onCambio(lineas(texto))} />
    </Campo>
  );
}

function EditorLeccion({ valor, onCambio, onBorrar }: { valor: LeccionRecorrido; onCambio: (v: LeccionRecorrido) => void; onBorrar: () => void }) {
  const [abierta, setAbierta] = useState(false);
  const set = <K extends keyof LeccionRecorrido>(k: K, v: LeccionRecorrido[K]) => onCambio({ ...valor, [k]: v });
  return (
    <div className="rounded-xl border bg-background">
      <button type="button" onClick={() => setAbierta((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold">
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !abierta && "-rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{valor.titulo || "Lección sin título"}</span>
      </button>
      {abierta && (
        <div className="space-y-2.5 border-t p-3">
          <Campo label="Título">
            <Input value={valor.titulo} onChange={(e) => set("titulo", e.target.value)} />
          </Campo>
          <Campo label="Objetivo">
            <Input value={valor.objetivo} onChange={(e) => set("objetivo", e.target.value)} />
          </Campo>
          <Campo label="Explicación (un párrafo por línea)">
            <Textarea value={valor.explicacion} rows={6} onChange={(e) => set("explicacion", e.target.value)} />
          </Campo>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Lista label="Bien" valor={valor.bien} onCambio={(v) => set("bien", v)} />
            <Lista label="Mal" valor={valor.mal} onCambio={(v) => set("mal", v)} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Ejercicios de la lección</p>
            <EditorPreguntas valor={valor.ejercicios ?? []} onCambio={(v) => set("ejercicios", v)} />
          </div>
          <Campo label="Video (link de YouTube, Drive o .mp4; opcional)">
            <Input value={valor.video ?? ""} onChange={(e) => set("video", e.target.value.trim() || undefined)} placeholder="https://…" />
          </Campo>
          <Button variant="ghost" size="sm" onClick={onBorrar} className="text-red-600">
            <Trash2 className="mr-1.5 h-4 w-4" /> Borrar lección
          </Button>
        </div>
      )}
    </div>
  );
}

function EditorPreguntas({ valor, onCambio }: { valor: PreguntaRecorrido[]; onCambio: (v: PreguntaRecorrido[]) => void }) {
  const set = (i: number, p: PreguntaRecorrido) => onCambio(valor.map((x, j) => (j === i ? p : x)));
  return (
    <div className="space-y-2">
      {valor.map((p, i) => (
        <div key={i} className="space-y-2 rounded-xl border p-3">
          <div className="flex gap-2">
            <Input value={p.texto} onChange={(e) => set(i, { ...p, texto: e.target.value })} placeholder={`Pregunta ${i + 1}`} />
            <Button variant="ghost" size="icon" onClick={() => onCambio(valor.filter((_, j) => j !== i))} title="Borrar pregunta">
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
          {p.ordenar ? (
            <Lista label="Pasos en el orden correcto" valor={p.ordenar} onCambio={(ordenar) => set(i, { ...p, ordenar })} rows={4} />
          ) : p.unir ? (
            <Lista
              label="Pares: «Palabra = Lo que va con ella»"
              valor={p.unir.map((x) => `${x[0]} = ${x[1]}`)}
              onCambio={(l) => set(i, { ...p, unir: l.map((x): [string, string] => { const [a = "", b = ""] = x.split("=").map((t) => t.trim()); return [a, b]; }) })}
              rows={4}
            />
          ) : (
            <>
          {p.opciones.map((o, j) => (
            <div key={j} className="flex items-center gap-2">
              <input type="radio" checked={p.correcta === j} onChange={() => set(i, { ...p, correcta: j })} title="Respuesta correcta" className="h-4 w-4 accent-emerald-500" />
              <Input value={o} onChange={(e) => set(i, { ...p, opciones: p.opciones.map((x, k) => (k === j ? e.target.value : x)) })} className="h-9" />
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Marcá con el círculo la respuesta correcta. Para completar una frase, poné ___ en el texto.</p>
            </>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={() => onCambio([...valor, { texto: "", opciones: ["", "", ""], correcta: 0 }])} className="rounded-full">
          <Plus className="mr-1.5 h-4 w-4" /> Pregunta
        </Button>
        <Button variant="outline" size="sm" onClick={() => onCambio([...valor, { texto: "Ordená los pasos", opciones: [], correcta: 0, ordenar: [] }])} className="rounded-full">
          <Plus className="mr-1.5 h-4 w-4" /> Ordenar
        </Button>
        <Button variant="outline" size="sm" onClick={() => onCambio([...valor, { texto: "Uní cada palabra con lo que significa", opciones: [], correcta: 0, unir: [] }])} className="rounded-full">
          <Plus className="mr-1.5 h-4 w-4" /> Unir
        </Button>
      </div>
    </div>
  );
}

function EditorModulo({ valor, onCambio, onBorrar }: { valor: ModuloRecorrido; onCambio: (v: ModuloRecorrido) => void; onBorrar: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const set = <K extends keyof ModuloRecorrido>(k: K, v: ModuloRecorrido[K]) => onCambio({ ...valor, [k]: v });
  const nuevaLeccion = () => {
    const usados = new Set(valor.lecciones.map((l) => l.id));
    let id = `${valor.id}-${slug("nueva")}`;
    for (let n = 2; usados.has(id); n++) id = `${valor.id}-nueva-${n}`;
    set("lecciones", [...valor.lecciones, { id, titulo: "Nueva lección", objetivo: "", explicacion: "", bien: [], mal: [], ejercicios: [] }]);
  };
  return (
    <div className="rounded-2xl border bg-card">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center gap-2 p-4 text-left font-semibold">
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !abierto && "-rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{valor.titulo}</span>
        <span className="text-xs font-normal text-muted-foreground">{valor.lecciones.length} lecciones</span>
      </button>
      {abierto && (
        <div className="space-y-4 border-t p-4">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Campo label="Título de la semana">
              <Input value={valor.titulo} onChange={(e) => set("titulo", e.target.value)} />
            </Campo>
            <Campo label="Bajada">
              <Input value={valor.subtitulo} onChange={(e) => set("subtitulo", e.target.value)} />
            </Campo>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Lecciones</p>
            {valor.lecciones.map((l, i) => (
              <EditorLeccion key={l.id} valor={l} onCambio={(v) => set("lecciones", valor.lecciones.map((x, j) => (j === i ? v : x)))} onBorrar={() => confirm(`¿Borrar «${l.titulo}»?`) && set("lecciones", valor.lecciones.filter((_, j) => j !== i))} />
            ))}
            <Button variant="outline" size="sm" onClick={nuevaLeccion} className="rounded-full">
              <Plus className="mr-1.5 h-4 w-4" /> Lección
            </Button>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Repaso de la semana</p>
            <EditorPreguntas valor={valor.cuestionario} onCambio={(v) => set("cuestionario", v)} />
          </div>
          <Button variant="ghost" size="sm" onClick={onBorrar} className="text-red-600">
            <Trash2 className="mr-1.5 h-4 w-4" /> Borrar semana
          </Button>
        </div>
      )}
    </div>
  );
}

export function EditorRecorrido({ recorrido }: { recorrido: Recorrido }) {
  const [r, setR] = useState<Recorrido>(recorrido);
  const [guardando, setGuardando] = useState(false);
  const [cambios, setCambios] = useState(false);
  useEffect(() => {
    if (!cambios) setR(recorrido);
  }, [recorrido, cambios]);
  const set = <K extends keyof Recorrido>(k: K, v: Recorrido[K]) => {
    setR((x) => ({ ...x, [k]: v }));
    setCambios(true);
  };
  const [glosario, setGlosario] = useState(() => recorrido.glosario.map((g) => `${g.termino}: ${g.definicion}`).join("\n"));

  const guardar = async () => {
    setGuardando(true);
    try {
      await guardarRecorrido(r);
      setCambios(false);
      toast.success("Guardado. Ya lo ven así.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  const nuevoModulo = () => {
    const n = r.modulos.length + 1;
    let id = `s${n}`;
    for (let k = n + 1; r.modulos.some((m) => m.id === id); k++) id = `s${k}`;
    set("modulos", [...r.modulos, { id, titulo: `Semana ${n}`, subtitulo: "", lecciones: [], cuestionario: [] }]);
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-background/95 p-3 backdrop-blur">
        <p className="text-sm text-muted-foreground">{cambios ? "Tenés cambios sin guardar." : "Editá el contenido: quien lo hace lo ve al guardar."}</p>
        <Button onClick={() => void guardar()} disabled={guardando || !cambios} className="rounded-full">
          {guardando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Guardar
        </Button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Campo label="Nombre del recorrido">
          <Input value={r.titulo} onChange={(e) => set("titulo", e.target.value)} />
        </Campo>
        <Campo label="Descripción">
          <Input value={r.descripcion} onChange={(e) => set("descripcion", e.target.value)} />
        </Campo>
      </div>
      <div className="space-y-2.5">
        {r.modulos.map((m, i) => (
          <EditorModulo key={m.id} valor={m} onCambio={(v) => set("modulos", r.modulos.map((x, j) => (j === i ? v : x)))} onBorrar={() => confirm(`¿Borrar «${m.titulo}» con sus lecciones?`) && set("modulos", r.modulos.filter((_, j) => j !== i))} />
        ))}
        <Button variant="outline" onClick={nuevoModulo} className="rounded-full">
          <Plus className="mr-1.5 h-4 w-4" /> Semana
        </Button>
      </div>
      <div className="space-y-2 rounded-2xl border bg-card p-4">
        <p className="font-semibold">Examen final</p>
        <Campo label="Descripción">
          <Input value={r.examen.consigna} onChange={(e) => set("examen", { ...r.examen, consigna: e.target.value })} />
        </Campo>
        <EditorPreguntas valor={r.examen.preguntas} onCambio={(preguntas) => set("examen", { ...r.examen, preguntas })} />
      </div>
      <div className="space-y-2 rounded-2xl border bg-card p-4">
        <p className="font-semibold">Glosario</p>
        <Campo label="Una palabra por línea: «Palabra: qué significa»">
          <Textarea
            value={glosario}
            rows={8}
            onChange={(e) => setGlosario(e.target.value)}
            onBlur={() =>
              set(
                "glosario",
                lineas(glosario).map((l) => {
                  const i = l.indexOf(":");
                  return i > 0 ? { termino: l.slice(0, i).trim(), definicion: l.slice(i + 1).trim() } : { termino: l, definicion: "" };
                })
              )
            }
          />
        </Campo>
      </div>
    </div>
  );
}
