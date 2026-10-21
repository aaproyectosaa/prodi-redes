import { useEffect, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { callApi } from "@/lib/redes/api";
import { assertEditable } from "@/lib/redes/vistaComo";
import type { Video } from "@/lib/redes/types";

/** Igual que en el servidor (api/pagos pedido-corregir). */
const VENTANA_MS = 2 * 60 * 60_000;

/** ¿Quien mira puede todavía corregir o borrar este pedido? (lo pidió él, hace menos de 2 h y no se empezó). */
export function puedeCorregirPedido(video: Video, uid: string | undefined): boolean {
  if (!uid || video.pedido_cliente !== true || video.created_by !== uid) return false;
  if (!["material_cliente", "planificado"].includes(video.etapa) || video.rodaje_id || (video.attachments_crudo ?? []).length) return false;
  return Date.now() - new Date(video.created_at).getTime() < VENTANA_MS;
}

/**
 * "¿Lo cargaste mal?": en las primeras 2 horas el cliente corrige el título, la idea y el objetivo de un video que
 * pidió, o lo borra (si no tiene pagos). Después, se lo pide al equipo por el chat.
 */
export function CorregirPedido({ video, onBorrado }: { video: Video; onBorrado?: () => void }) {
  const { user } = useUserProfileContext();
  const [, setTick] = useState(0);
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(video.titulo);
  const [idea, setIdea] = useState(video.idea ?? "");
  const [objetivo, setObjetivo] = useState(video.objetivo ?? "");
  const [busy, setBusy] = useState<"guardar" | "borrar" | null>(null);

  // Se vuelve a mirar cada minuto: a las 2 horas desaparece solo.
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  if (!puedeCorregirPedido(video, user?.uid)) return null;
  const hasta = new Date(new Date(video.created_at).getTime() + VENTANA_MS).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const tienePago = video.extra_pagado === true || Number(video.viatico?.monto ?? 0) > 0;

  const guardar = async () => {
    setBusy("guardar");
    try {
      assertEditable();
      await callApi("/api/pagos/pedido-corregir", { video_id: video.id, accion: "editar", titulo, idea, objetivo, fecha_deseada: video.fecha_deseada ?? null });
      toast.success("Listo, lo corregimos");
      setEditando(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(null);
    }
  };
  const borrar = async () => {
    if (!window.confirm(`¿Borrar “${video.titulo}”? Si era del plan, te queda el lugar libre para pedir otro.`)) return;
    setBusy("borrar");
    try {
      assertEditable();
      await callApi("/api/pagos/pedido-corregir", { video_id: video.id, accion: "borrar" });
      toast.success("Listo, lo borramos");
      onBorrado?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo borrar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <div>
        <p className="text-sm font-semibold">¿Lo cargaste mal?</p>
        <p className="text-xs text-muted-foreground">Lo podés corregir{tienePago ? "" : " o borrar"} hasta las {hasta}. Después, pedínoslo por el chat.</p>
      </div>
      {editando ? (
        <div className="space-y-2">
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título" maxLength={140} className="h-10 rounded-xl bg-background" />
          <Textarea value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Qué querés que muestre el video" rows={4} className="rounded-xl bg-background" />
          <Input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Para qué es (opcional)" maxLength={300} className="h-10 rounded-xl bg-background" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditando(false)} disabled={!!busy}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void guardar()} disabled={!!busy || titulo.trim().length < 3}>
              {busy === "guardar" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="rounded-full bg-background" onClick={() => setEditando(true)} disabled={!!busy}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
          </Button>
          {!tienePago && (
            <Button variant="outline" size="sm" className="rounded-full bg-background text-destructive hover:text-destructive" onClick={() => void borrar()} disabled={!!busy}>
              {busy === "borrar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
              Borrar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
