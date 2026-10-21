import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { asset } from "@/lib/asset";
import { cn } from "@/lib/utils";
import { nuevoIdP, type Propuesta, type SeccionPropuesta } from "../../../api/_lib/propuesta";

// La propuesta comercial con el diseño de los PDF de Prodi (fondo negro, violeta, tarjetas y tabla de inversión).
// Con `onCambiar` se edita ahí mismo: se toca cualquier texto y se escribe; se agregan o quitan tarjetas, filas,
// viñetas y secciones. Sin `onCambiar` es solo para ver (el link del cliente).

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const fechaLarga = (f: string) => {
  const [a, m, d] = f.slice(0, 10).split("-").map(Number);
  return a && m && d ? `${d} de ${MESES[m - 1]} de ${a}` : f;
};

/** **negrita** → <b>. */
function Rico({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <b key={i} className="font-semibold text-white">
            {p.slice(2, -2)}
          </b>
        ) : (
          p
        )
      )}
    </>
  );
}

/** Texto que se edita tocándolo (se ve igual que el resto hasta que se toca). */
function Campo({
  valor,
  onCambiar,
  vacio,
  className,
  multilinea,
  rico,
}: {
  valor: string;
  onCambiar?: (v: string) => void;
  vacio?: string;
  className?: string;
  multilinea?: boolean;
  rico?: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!editando || !t) return;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, [editando]);
  useEffect(() => {
    const t = ref.current;
    if (t) {
      t.style.height = "auto";
      t.style.height = `${t.scrollHeight}px`;
    }
  });
  if (!onCambiar) return valor ? <span className={className}>{rico ? <Rico texto={valor} /> : valor}</span> : null;
  if (editando)
    return (
      <textarea
        ref={ref}
        value={valor}
        rows={1}
        onChange={(e) => onCambiar(multilinea ? e.target.value : e.target.value.replace(/\n/g, " "))}
        onBlur={() => setEditando(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "Enter" && !multilinea)) {
            e.preventDefault();
            setEditando(false);
          }
        }}
        className={cn("block w-full resize-none overflow-hidden rounded-md bg-white/[0.06] px-1 -mx-1 outline-none ring-1 ring-violet-400/60", className)}
      />
    );
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditando(true)}
      onFocus={() => setEditando(true)}
      className={cn("cursor-text rounded-md px-1 -mx-1 transition-colors hover:bg-white/[0.06] hover:ring-1 hover:ring-violet-400/40", !valor && "italic text-violet-300/60", className)}
    >
      {valor ? rico ? <Rico texto={valor} /> : valor : vacio ?? "Tocá para escribir"}
    </span>
  );
}

function BotonChico({ onClick, children, titulo, peligro }: { onClick: () => void; children: React.ReactNode; titulo: string; peligro?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={cn("flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10", peligro ? "hover:text-red-400" : "hover:text-white")}
    >
      {children}
    </button>
  );
}

function Agregar({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-dashed border-violet-400/40 px-3 py-1 text-xs font-medium text-violet-300 transition-colors hover:border-violet-300 hover:bg-violet-500/10"
    >
      <Plus className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

const TITULOS_NUEVA: Record<SeccionPropuesta["tipo"], string> = { detalle: "Qué hacemos", inversion: "Inversión", condiciones: "Condiciones esenciales", texto: "Aclaración" };

export function seccionNueva(tipo: SeccionPropuesta["tipo"]): SeccionPropuesta {
  const base = { id: nuevoIdP(), tipo, titulo: TITULOS_NUEVA[tipo] };
  if (tipo === "detalle") return { ...base, tarjetas: [{ id: nuevoIdP(), titulo: "", resumen: "", vinetas: [] }] };
  if (tipo === "inversion") return { ...base, columna: "MENSUAL", filas: [{ id: nuevoIdP(), concepto: "", detalle: "", valor: "" }], total: null, nota: "" };
  if (tipo === "condiciones") return { ...base, items: [{ id: nuevoIdP(), titulo: "", texto: "" }] };
  return { ...base, texto: "" };
}

function Seccion({
  s,
  n,
  onCambiar,
  onQuitar,
  onMover,
}: {
  s: SeccionPropuesta;
  n: number;
  onCambiar?: (s: SeccionPropuesta) => void;
  onQuitar?: () => void;
  onMover?: (d: -1 | 1) => void;
}) {
  const ed = !!onCambiar;
  const set = (c: Partial<SeccionPropuesta>) => onCambiar?.({ ...s, ...c });
  const tarjetas = s.tarjetas ?? [];
  const filas = s.filas ?? [];
  const items = s.items ?? [];
  return (
    <section className="group/sec mt-8 break-inside-avoid">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-baseline gap-4 text-[1.35rem] font-bold leading-tight text-white">
            <span className="text-sm font-bold text-violet-400">{String(n).padStart(2, "0")}</span>
            <Campo valor={s.titulo} onCambiar={ed ? (v) => set({ titulo: v }) : undefined} vacio="Título de la sección" />
          </h2>
          <div className="mt-2 h-0.5 w-14 bg-violet-500" />
        </div>
        {ed && (
          <div className="flex shrink-0 gap-0.5 opacity-60 transition-opacity group-hover/sec:opacity-100 print:hidden">
            <BotonChico titulo="Subir sección" onClick={() => onMover?.(-1)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </BotonChico>
            <BotonChico titulo="Bajar sección" onClick={() => onMover?.(1)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </BotonChico>
            <BotonChico titulo="Quitar sección" peligro onClick={() => onQuitar?.()}>
              <Trash2 className="h-3.5 w-3.5" />
            </BotonChico>
          </div>
        )}
      </div>

      {s.tipo === "detalle" && (
        <div className="mt-6 space-y-4">
          {tarjetas.map((c, i) => {
            const setT = (cc: Partial<typeof c>) => set({ tarjetas: tarjetas.map((x) => (x.id === c.id ? { ...x, ...cc } : x)) });
            return (
              <div key={c.id} className="group/t relative break-inside-avoid rounded-2xl border border-white/10 bg-[#111018] px-5 py-4">
                {ed && (
                  <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/t:opacity-100 print:hidden">
                    <BotonChico titulo="Quitar" peligro onClick={() => set({ tarjetas: tarjetas.filter((x) => x.id !== c.id) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </BotonChico>
                  </div>
                )}
                <p className="text-[1.05rem] font-bold text-violet-400">
                  <Campo valor={c.titulo} onCambiar={ed ? (v) => setT({ titulo: v }) : undefined} vacio={`Comercio o servicio ${i + 1}`} />
                </p>
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  <Campo valor={c.resumen} onCambiar={ed ? (v) => setT({ resumen: v }) : undefined} vacio="Resumen: qué incluye en una línea" multilinea rico />
                </p>
                {(c.vinetas.length > 0 || ed) && (
                  <ul className="mt-2 space-y-1.5">
                    {c.vinetas.map((v, j) => (
                      <li key={j} className="group/v flex gap-3 text-sm leading-relaxed text-white/70">
                        <span className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                        <span className="min-w-0 flex-1">
                          <Campo
                            valor={v}
                            onCambiar={ed ? (nv) => setT({ vinetas: c.vinetas.map((x, k) => (k === j ? nv : x)) }) : undefined}
                            vacio="Detalle"
                            multilinea
                            rico
                          />
                        </span>
                        {ed && (
                          <span className="opacity-0 transition-opacity group-hover/v:opacity-100 print:hidden">
                            <BotonChico titulo="Quitar viñeta" peligro onClick={() => setT({ vinetas: c.vinetas.filter((_, k) => k !== j) })}>
                              <Trash2 className="h-3 w-3" />
                            </BotonChico>
                          </span>
                        )}
                      </li>
                    ))}
                    {ed && (
                      <li className="pl-4 print:hidden">
                        <button type="button" onClick={() => setT({ vinetas: [...c.vinetas, ""] })} className="text-xs font-medium text-violet-300/80 hover:text-violet-200">
                          + viñeta
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
          {ed && (
            <div className="print:hidden">
              <Agregar onClick={() => set({ tarjetas: [...tarjetas, { id: nuevoIdP(), titulo: "", resumen: "", vinetas: [] }] })}>Tarjeta</Agregar>
            </div>
          )}
        </div>
      )}

      {s.tipo === "inversion" && (
        <div className="mt-6">
          <div className="flex justify-between px-5 pb-2 text-[11px] font-bold uppercase tracking-wider text-white/60">
            <span>Concepto</span>
            <Campo valor={s.columna ?? ""} onCambiar={ed ? (v) => set({ columna: v.toUpperCase() }) : undefined} vacio="MENSUAL" />
          </div>
          <div className="space-y-2">
            {filas.map((f) => {
              const setF = (cc: Partial<typeof f>) => set({ filas: filas.map((x) => (x.id === f.id ? { ...x, ...cc } : x)) });
              return (
                <div key={f.id} className="group/f flex items-center gap-4 break-inside-avoid rounded-xl border border-white/10 bg-[#111018] px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.95rem] font-bold text-white">
                      <Campo valor={f.concepto} onCambiar={ed ? (v) => setF({ concepto: v }) : undefined} vacio="Concepto" />
                    </p>
                    <p className="text-xs text-white/55">
                      <Campo valor={f.detalle} onCambiar={ed ? (v) => setF({ detalle: v }) : undefined} vacio="Detalle (qué incluye)" />
                    </p>
                  </div>
                  <p className={cn("shrink-0 text-right text-lg font-bold", f.valor ? "text-violet-400" : "text-amber-300")}>
                    <Campo valor={f.valor} onCambiar={ed ? (v) => setF({ valor: v }) : undefined} vacio="Poné el precio" className="block min-w-[7rem]" />
                  </p>
                  {ed && (
                    <span className="opacity-0 transition-opacity group-hover/f:opacity-100 print:hidden">
                      <BotonChico titulo="Quitar fila" peligro onClick={() => set({ filas: filas.filter((x) => x.id !== f.id) })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </BotonChico>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {s.total && (
            <div className="group/tot relative mt-3 flex items-center gap-4 break-inside-avoid rounded-xl border border-violet-500/70 bg-gradient-to-r from-[#2a1a6e] to-[#1a1240] px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-[1.05rem] font-bold uppercase text-white">
                  <Campo valor={s.total.etiqueta} onCambiar={ed ? (v) => set({ total: { ...s.total!, etiqueta: v } }) : undefined} vacio="TOTAL · mensual" />
                </p>
                <p className="text-xs text-white/60">
                  <Campo valor={s.total.detalle} onCambiar={ed ? (v) => set({ total: { ...s.total!, detalle: v } }) : undefined} vacio="Resumen · + IVA con factura A" />
                </p>
              </div>
              <p className={cn("shrink-0 text-right text-2xl font-bold", s.total.valor ? "text-violet-300" : "text-amber-300")}>
                <Campo valor={s.total.valor} onCambiar={ed ? (v) => set({ total: { ...s.total!, valor: v } }) : undefined} vacio="Poné el total" className="block min-w-[7rem]" />
              </p>
              {ed && (
                <span className="opacity-0 transition-opacity group-hover/tot:opacity-100 print:hidden">
                  <BotonChico titulo="Quitar total" peligro onClick={() => set({ total: null })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </BotonChico>
                </span>
              )}
            </div>
          )}
          {(s.nota || ed) && (
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              <Campo valor={s.nota ?? ""} onCambiar={ed ? (v) => set({ nota: v }) : undefined} vacio="Nota abajo de la tabla (opcional)" multilinea rico />
            </p>
          )}
          {ed && (
            <div className="mt-3 flex flex-wrap gap-2 print:hidden">
              <Agregar onClick={() => set({ filas: [...filas, { id: nuevoIdP(), concepto: "", detalle: "", valor: "" }] })}>Fila</Agregar>
              {!s.total && <Agregar onClick={() => set({ total: { etiqueta: "TOTAL · mensual", detalle: "", valor: "" } })}>Total destacado</Agregar>}
            </div>
          )}
        </div>
      )}

      {s.tipo === "condiciones" && (
        <ul className="mt-6 space-y-3">
          {items.map((c) => {
            const setC = (cc: Partial<typeof c>) => set({ items: items.map((x) => (x.id === c.id ? { ...x, ...cc } : x)) });
            return (
              <li key={c.id} className="group/c flex gap-3 text-[0.95rem] leading-relaxed text-white/90">
                <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                <span className="min-w-0 flex-1">
                  <b className="font-bold text-white">
                    <Campo valor={c.titulo} onCambiar={ed ? (v) => setC({ titulo: v }) : undefined} vacio="Título" />
                    {c.titulo && !ed ? "." : ""}
                  </b>{" "}
                  <Campo valor={c.texto} onCambiar={ed ? (v) => setC({ texto: v }) : undefined} vacio="Texto de la condición" multilinea rico />
                </span>
                {ed && (
                  <span className="opacity-0 transition-opacity group-hover/c:opacity-100 print:hidden">
                    <BotonChico titulo="Quitar" peligro onClick={() => set({ items: items.filter((x) => x.id !== c.id) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </BotonChico>
                  </span>
                )}
              </li>
            );
          })}
          {ed && (
            <li className="print:hidden">
              <Agregar onClick={() => set({ items: [...items, { id: nuevoIdP(), titulo: "", texto: "" }] })}>Condición</Agregar>
            </li>
          )}
        </ul>
      )}

      {s.tipo === "texto" && (
        <p className="mt-5 text-[0.95rem] leading-relaxed text-white/80">
          <Campo valor={s.texto ?? ""} onCambiar={ed ? (v) => set({ texto: v }) : undefined} vacio="Escribí el texto" multilinea rico />
        </p>
      )}
    </section>
  );
}

export function PropuestaVista({ p, onCambiar, validez, className }: { p: Propuesta; onCambiar?: (p: Propuesta) => void; validez?: string | null; className?: string }) {
  const ed = !!onCambiar;
  const set = (c: Partial<Propuesta>) => onCambiar?.({ ...p, ...c });
  const setSecciones = (secciones: SeccionPropuesta[]) => set({ secciones });
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= p.secciones.length) return;
    const l = [...p.secciones];
    [l[i], l[j]] = [l[j], l[i]];
    setSecciones(l);
  };
  return (
    <div className={cn("relative overflow-hidden bg-black px-6 py-8 font-sans text-white sm:px-12 sm:py-10", className)}>
      <div className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(111,64,252,0.55)_0%,rgba(76,29,149,0.25)_35%,transparent_70%)]" />
      <div className="relative">
        <div className="flex items-center justify-between border-b border-violet-500/30 pb-4">
          <img src={asset("/brand/isotipo.png")} alt="Prodi" className="h-8 w-auto" />
          <span className="text-xs text-white/60">Propuesta comercial</span>
        </div>

        <p className="mt-6 text-sm font-bold uppercase tracking-wide text-violet-400">
          <Campo valor={p.etiqueta} onCambiar={ed ? (v) => set({ etiqueta: v }) : undefined} vacio="Propuesta resumida · de qué se trata" />
        </p>
        <h1 className="mt-1 text-3xl font-bold leading-tight sm:text-[2.4rem]">
          <Campo valor={p.titulo} onCambiar={ed ? (v) => set({ titulo: v }) : undefined} vacio="Nombre del cliente" />
        </h1>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-1 text-sm text-white/55">
          {(ed || p.codigo) && (
            <>
              <span>Propuesta N°</span>
              <Campo valor={p.codigo} onCambiar={ed ? (v) => set({ codigo: v }) : undefined} vacio="número" />
              <span>·</span>
            </>
          )}
          <Campo valor={p.lugar} onCambiar={ed ? (v) => set({ lugar: v }) : undefined} vacio="Ciudad" />
          <span>·</span>
          <span>{fechaLarga(p.fecha)}</span>
          {validez && <span>· válida hasta el {fechaLarga(validez)}</span>}
        </p>

        <p className="mt-6 text-[0.98rem] leading-relaxed text-white/85">
          <Campo valor={p.intro} onCambiar={ed ? (v) => set({ intro: v }) : undefined} vacio="Presentación: qué le proponemos en 3 o 4 líneas (con **negrita** lo importante)" multilinea rico />
        </p>

        {p.secciones.map((s, i) => (
          <Seccion
            key={s.id}
            s={s}
            n={i + 1}
            onCambiar={ed ? (ns) => setSecciones(p.secciones.map((x) => (x.id === s.id ? ns : x))) : undefined}
            onQuitar={() => window.confirm(`¿Quitar la sección "${s.titulo || "sin título"}"?`) && setSecciones(p.secciones.filter((x) => x.id !== s.id))}
            onMover={(d) => mover(i, d)}
          />
        ))}

        {ed && (
          <div className="mt-8 flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-white/15 p-3 print:hidden">
            <span className="text-xs text-white/50">Agregar sección:</span>
            <Agregar onClick={() => setSecciones([...p.secciones, seccionNueva("detalle")])}>Qué hacemos</Agregar>
            <Agregar onClick={() => setSecciones([...p.secciones, seccionNueva("inversion")])}>Inversión</Agregar>
            <Agregar onClick={() => setSecciones([...p.secciones, seccionNueva("condiciones")])}>Condiciones</Agregar>
            <Agregar onClick={() => setSecciones([...p.secciones, seccionNueva("texto")])}>Texto</Agregar>
          </div>
        )}

        <p className="mt-6 text-sm text-white/55">
          <Campo valor={p.contacto} onCambiar={ed ? (v) => set({ contacto: v }) : undefined} vacio="Contacto" />
        </p>
        <div className="mt-8 border-t border-violet-500/30 pt-3 text-xs text-white/50">Prodi · somosprodi.com · @prodisolo · @prodi.software</div>
      </div>
    </div>
  );
}
