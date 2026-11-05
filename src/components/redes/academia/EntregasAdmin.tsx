import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, CheckCircle2, ExternalLink, FileText, Inbox, Loader2, MessageSquareWarning, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CorreccionesDialog, ReproductorMarcas } from "@/components/redes/MarcasVideo";
import { db } from "@/integrations/firebase/client";
import { doc, updateDoc } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import { fechaCorta } from "@/lib/redes/format";
import { ESTADO_ENTREGA, ID_EXAMEN, ultimoVideo, type EntregaAcademia, type Recorrido } from "@/lib/redes/academiaRecorrido";
import type { MarcaCorreccion } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

// Admin: los ejercicios de la Academia. Los que esperan revisión primero; se aprueban o se devuelven con marcas en el
// segundo exacto del video (las mismas de la ficha del video). Con el examen aprobado, se le habilita el rol de productora.

async function revisar(e: EntregaAcademia, patch: Partial<EntregaAcademia>) {
  const at = new Date().toISOString();
  await updateDoc(doc(db, "academia_entregas", e.id), { ...patch, revisada_at: at, updated_at: at });
  await callApi("/api/usuarios/academia-aviso", { entrega_id: e.id }).catch(() => undefined);
}

function Revision({ entrega, open, onOpenChange }: { entrega: EntregaAcademia; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [devolucion, setDevolucion] = useState("");
  const [corregir, setCorregir] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  useEffect(() => {
    setDevolucion("");
  }, [entrega.id, open]);
  const video = ultimoVideo(entrega);
  const archivos = entrega.attachments_crudo ?? [];

  const aprobar = async () => {
    setGuardando("aprobar");
    try {
      await revisar(entrega, { estado: "aprobada", devolucion: devolucion.trim() || entrega.devolucion || "", marcas: [] });
      toast.success("Aprobado. Le avisamos.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(null);
    }
  };
  const devolver = async (nota: string, marcas: MarcaCorreccion[]) => {
    await revisar(entrega, { estado: "a_corregir", devolucion: nota, marcas });
    toast.success("Le mandamos las correcciones");
    onOpenChange(false);
  };
  const habilitar = async () => {
    if (!confirm(`¿Le cambiás el rol a ${entrega.nombre} de «Productora en formación» a «Producción»?`)) return;
    setGuardando("rol");
    try {
      await callApi("/api/usuarios/editar", { uid: entrega.uid, rol: "productor" });
      toast.success(`${entrega.nombre} ya es productora. Asignale sus clientes en Equipo.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el rol");
    } finally {
      setGuardando(null);
    }
  };

  return (
    <>
      <Dialog open={open && !corregir} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{entrega.item_titulo}</DialogTitle>
            <DialogDescription>
              {entrega.nombre}
              {entrega.enviada_at ? ` · mandado el ${fechaCorta(entrega.enviada_at.slice(0, 10))}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {video && <ReproductorMarcas attachment={video} marcas={entrega.marcas ?? []} />}
            {archivos.length > 0 && (
              <ul className="space-y-1.5">
                {archivos.map((a) => (
                  <li key={a.drive_file_id}>
                    <a href={a.web_view_link} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:border-primary/50">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {entrega.nota_alumno && (
              <p className="whitespace-pre-line rounded-xl bg-muted/60 p-3 text-sm">
                <b>Nota:</b> {entrega.nota_alumno}
              </p>
            )}
            <Textarea value={devolucion} onChange={(e) => setDevolucion(e.target.value)} placeholder="Un comentario para cuando lo aprobás (opcional)" rows={2} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void aprobar()} disabled={!!guardando} className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500">
                {guardando === "aprobar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Aprobar
              </Button>
              <Button variant="outline" onClick={() => setCorregir(true)} disabled={!!guardando} className="rounded-full border-orange-500/50">
                <MessageSquareWarning className="mr-1.5 h-4 w-4 text-orange-600" /> Pedir correcciones
              </Button>
              {entrega.item_id === ID_EXAMEN && entrega.estado === "aprobada" && (
                <Button variant="secondary" onClick={() => void habilitar()} disabled={!!guardando} className="rounded-full">
                  {guardando === "rol" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserCheck className="mr-1.5 h-4 w-4" />} Habilitar como productora
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <CorreccionesDialog
        attachment={video}
        open={open && corregir}
        onOpenChange={(v) => {
          setCorregir(v);
          if (!v) onOpenChange(false);
        }}
        title={`Correcciones · ${entrega.item_titulo}`}
        description={`Marcá el segundo exacto de cada cosa a corregir. A ${entrega.nombre} le llega un aviso.`}
        placeholder="Ej.: la luz está bien, pero usá trípode en las tomas fijas"
        confirmLabel="Mandar correcciones"
        onConfirm={devolver}
      />
    </>
  );
}

export function EntregasAdmin({ recorrido, entregas, abrir }: { recorrido: Recorrido; entregas: EntregaAcademia[] | null; abrir?: string | null }) {
  const [filtro, setFiltro] = useState<"revisar" | "todas">("revisar");
  const [abierta, setAbierta] = useState<string | null>(abrir ?? null);
  useEffect(() => {
    if (abrir) setAbierta(abrir);
  }, [abrir]);
  const lista = useMemo(
    () =>
      (entregas ?? [])
        .filter((e) => e.recorrido_id === recorrido.id && e.estado !== "borrador" && (filtro === "todas" || e.estado === "enviada"))
        .sort((a, b) => Number(b.estado === "enviada") - Number(a.estado === "enviada") || (b.enviada_at ?? "").localeCompare(a.enviada_at ?? "")),
    [entregas, recorrido.id, filtro]
  );
  const actual = entregas?.find((e) => e.id === abierta);

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(["revisar", "todas"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={cn("h-9 rounded-full border px-4 text-sm font-semibold", filtro === f ? "border-transparent bg-foreground text-background" : "bg-card text-muted-foreground")}
          >
            {f === "revisar" ? "Para revisar" : "Todas"}
          </button>
        ))}
      </div>
      {entregas === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : !lista.length ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Inbox className="h-4 w-4" /> {filtro === "revisar" ? "No hay ejercicios esperando revisión." : "Todavía no mandaron ejercicios."}
        </p>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {lista.map((e) => (
            <button key={e.id} type="button" onClick={() => setAbierta(e.id)} className="flex items-start gap-3 rounded-2xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              {e.estado === "aprobada" ? <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-tight">{e.nombre}</span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{e.item_titulo}</span>
                <span className="mt-1.5 flex items-center gap-2 text-[11px]">
                  <span className={cn("rounded-full px-2 py-0.5 font-semibold", ESTADO_ENTREGA[e.estado].clase)}>{ESTADO_ENTREGA[e.estado].label}</span>
                  {e.enviada_at && <span className="text-muted-foreground">{fechaCorta(e.enviada_at.slice(0, 10))}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {actual && <Revision entrega={actual} open={!!abierta} onOpenChange={(v) => !v && setAbierta(null)} />}
    </div>
  );
}
