import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Mail, MapPin, MessageCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageShell, EmptyState } from "@/components/redes/PageShell";
import { collection, db, onSnapshot } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import { fechaHora, hace } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

// Postulantes de somosprodi.com/sumate: gente que quiere trabajar con Prodi, creadores que quieren recomendar el CRM
// con su link (25% durante 6 meses) y quien quiere llevar Prodi a su ciudad. Las crea /api/web/sumate; solo el super admin.

type Tipo = "trabajo" | "creador" | "franquicia";
type Estado = "nuevo" | "contactado" | "aceptado" | "descartado";

interface Postulante {
  id: string;
  created_at: string;
  tipo: Tipo;
  nombre: string;
  email: string;
  telefono: string;
  ciudad: string;
  estado: Estado;
  notas?: string;
  // Trabajo
  rol?: string;
  experiencia?: string;
  herramientas?: string[];
  equipo?: string[];
  movilidad?: string;
  dedicacion?: string;
  portfolio?: string;
  cv?: string;
  cv_archivo?: { link?: string; nombre?: string; error?: string };
  instagram?: string;
  tiktok?: string;
  linkedin?: string;
  edad?: string;
  estudios?: string;
  inicio?: string;
  pretension?: string;
  porque?: string;
  // Creador
  redes?: string;
  seguidores?: string;
  tema?: string;
  // Franquicia
  mensaje?: string;
}

const TIPOS: Record<Tipo, string> = { trabajo: "Trabajo", creador: "Creadores", franquicia: "Franquicia" };
const ESTADOS: { id: Estado; label: string; clase: string }[] = [
  { id: "nuevo", label: "Nuevo", clase: "bg-primary/10 text-primary" },
  { id: "contactado", label: "Contactado", clase: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  { id: "aceptado", label: "Aceptado", clase: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  { id: "descartado", label: "Descartado", clase: "bg-muted text-muted-foreground" },
];
const estadoDe = (e: Estado) => ESTADOS.find((x) => x.id === e) ?? ESTADOS[0];

/** wa.me con el número tal como lo escribió (si no tiene código de país, se asume Argentina). */
function linkWhatsApp(tel: string): string {
  let n = tel.replace(/\D/g, "");
  if (!n.startsWith("54")) n = "549" + n.replace(/^0/, "");
  return `https://wa.me/${n}`;
}
/** @usuario → instagram.com/usuario; un dominio sin https → https://dominio. */
function linkDe(v?: string): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("@")) return `https://instagram.com/${t.slice(1)}`;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return `https://${t}`;
  return null;
}

function usePostulantes() {
  const [lista, setLista] = useState<Postulante[] | null>(null);
  useEffect(
    () =>
      onSnapshot(
        collection(db, "postulantes_web"),
        (s) => setLista(s.docs.map((d: { id: string; data: () => object }) => ({ id: d.id, ...d.data() }) as Postulante)),
        () => setLista([])
      ),
    []
  );
  return lista;
}

export default function Postulantes() {
  const lista = usePostulantes();
  const [tipo, setTipo] = useState<Tipo | "todos">("todos");
  const [verDescartados, setVerDescartados] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  // /postulantes?id=… (desde el aviso): abre esa postulación.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get("id");
    if (!id) return;
    setAbierto(id);
    const next = new URLSearchParams(params);
    next.delete("id");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const ordenada = useMemo(() => [...(lista ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)), [lista]);
  const visibles = ordenada.filter((p) => (tipo === "todos" || p.tipo === tipo) && (verDescartados || p.estado !== "descartado"));
  const actual = ordenada.find((p) => p.id === abierto) ?? null;

  return (
    <PageShell title="Postulantes" subtitle="Desde somosprodi.com/sumate: trabajo, creadores con referidos y franquicia">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(["todos", "trabajo", "creador", "franquicia"] as const).map((t) => {
          const n = t === "todos" ? ordenada.filter((p) => p.estado !== "descartado").length : ordenada.filter((p) => p.tipo === t && p.estado !== "descartado").length;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                tipo === t ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {t === "todos" ? "Todos" : TIPOS[t]}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={verDescartados} onChange={(e) => setVerDescartados(e.target.checked)} /> Ver descartados
        </label>
      </div>

      {lista === null ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visibles.length === 0 ? (
        <EmptyState icon={UserPlus} title="Todavía no hay postulantes" description="Cuando alguien complete somosprodi.com/sumate, aparece acá y te llega un aviso." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((p) => {
            const e = estadoDe(p.estado);
            return (
              <button key={p.id} type="button" onClick={() => setAbierto(p.id)} className="rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.nombre}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {TIPOS[p.tipo]}
                      {p.rol ? ` · ${p.rol}` : ""}
                      {p.seguidores ? ` · ${p.seguidores} seguidores` : ""}
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", e.clase)}>{e.label}</span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1 truncate">
                    <MapPin className="h-3.5 w-3.5 shrink-0" /> {p.ciudad}
                  </span>
                  <span className="ml-auto shrink-0">{hace(p.created_at)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Detalle postulante={actual} onClose={() => setAbierto(null)} />
    </PageShell>
  );
}

function Dato({ label, valor }: { label: string; valor?: string | string[] }) {
  const v = Array.isArray(valor) ? valor.join(", ") : valor;
  if (!v) return null;
  const link = Array.isArray(valor) ? null : linkDe(v);
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-sm text-primary hover:underline">
          {v} <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ) : (
        <div className="whitespace-pre-wrap text-sm">{v}</div>
      )}
    </div>
  );
}

function Detalle({ postulante: p, onClose }: { postulante: Postulante | null; onClose: () => void }) {
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setNotas(p?.notas ?? ""), [p?.id, p?.notas]);

  const guardar = async (cambios: { estado?: Estado; notas?: string }) => {
    if (!p) return;
    setGuardando(true);
    try {
      await callApi("/api/web/postulante-estado", { id: p.id, ...cambios });
      if (cambios.notas !== undefined) toast.success("Notas guardadas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {p && (
          <>
            <DialogHeader>
              <DialogTitle>{p.nombre}</DialogTitle>
              <DialogDescription>
                {TIPOS[p.tipo]} · {p.ciudad} · {fechaHora(p.created_at)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <a href={linkWhatsApp(p.telefono)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-1.5 h-4 w-4" /> {p.telefono}
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`mailto:${p.email}`}>
                  <Mail className="mr-1.5 h-4 w-4" /> {p.email}
                </a>
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ESTADOS.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  disabled={guardando}
                  onClick={() => guardar({ estado: e.id })}
                  className={cn(
                    "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                    p.estado === e.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40"
                  )}
                >
                  {e.label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 rounded-2xl border bg-muted/30 p-4">
              <Dato label="Edad" valor={p.edad} />
              <Dato label="Estudios" valor={p.estudios} />
              <Dato label="Qué hace" valor={p.rol} />
              <Dato label="Experiencia" valor={p.experiencia} />
              <Dato label="Herramientas" valor={p.herramientas} />
              <Dato label="Equipo propio" valor={p.equipo} />
              <Dato label="Movilidad" valor={p.movilidad} />
              <Dato label="Dedicación" valor={p.dedicacion} />
              <Dato label="Puede empezar" valor={p.inicio} />
              <Dato label="Pretensión" valor={p.pretension} />
              <Dato label="CV (PDF)" valor={p.cv_archivo?.link ?? p.cv_archivo?.error} />
              <Dato label="CV" valor={p.cv} />
              <Dato label="Portfolio" valor={p.portfolio} />
              <Dato label="Instagram" valor={p.instagram} />
              <Dato label="TikTok o YouTube" valor={p.tiktok} />
              <Dato label="LinkedIn" valor={p.linkedin} />
              <Dato label="Redes" valor={p.redes} />
              <Dato label="Seguidores" valor={p.seguidores} />
              <Dato label="De qué habla" valor={p.tema} />
              <Dato label="Por qué quiere sumarse" valor={p.porque} />
              <Dato label="Mensaje" valor={p.mensaje} />
            </div>

            <div className="grid gap-2">
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas internas (solo las ves vos)" rows={3} />
              <Button size="sm" variant="outline" disabled={guardando || notas === (p.notas ?? "")} onClick={() => guardar({ notas })} className="justify-self-end">
                Guardar notas
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
