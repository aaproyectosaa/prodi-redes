// Mandar el guion de uno o varios videos por chat: al grupo del cliente, a una persona del cliente
// (si no hay chat privado con ella, se abre) o a cualquier otro chat. Llega como mensaje con la tarjeta del video.

import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Search, Send, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChatIcon } from "@/components/redes/chat/ChatIcon";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { abrirDirecto, enviarMensaje, tituloChat } from "@/lib/redes/chat";
import { abrirEnDock } from "@/lib/redes/chatDock";
import { cn } from "@/lib/utils";
import type { Chat, Video } from "@/lib/redes/types";

const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** El texto que se manda: el título y lo que dice la persona a cámara (las tomas son del equipo, no se mandan). */
export function textoGuion(v: Pick<Video, "titulo" | "idea" | "guion">): string {
  const partes = [`🎬 *${v.titulo}*`];
  if (v.guion?.trim()) partes.push(`🎤 Lo que vas a decir a cámara:\n${v.guion.trim()}`);
  else if (v.idea?.trim()) partes.push(`Idea: ${v.idea.trim()}`);
  return partes.join("\n\n");
}

type Destino = { tipo: "chat"; id: string } | { tipo: "persona"; uid: string; nombre: string };

export function CompartirGuion({
  open,
  onOpenChange,
  videos,
  proyectoId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  videos: Video[];
  proyectoId: string;
}) {
  const { chats, clienteById } = useRedes();
  const { profiles } = useAppData();
  const { user, role, profile } = useUserProfileContext();
  const [busca, setBusca] = useState("");
  const [destino, setDestino] = useState<Destino | null>(null);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const cliente = clienteById(proyectoId);

  useEffect(() => {
    if (!open) return;
    setBusca("");
    setNota("");
    setDestino(null);
  }, [open]);

  // Personas del cliente (dueño/a y contactos): se les puede mandar directo.
  const personas = useMemo(() => {
    const ids = new Set(cliente?.team_roles?.cliente ?? []);
    return profiles
      .filter((p) => p.id !== user?.uid && p.activo !== false && (ids.has(p.id) || (p.role === "contacto" && (p.project_permissions ?? []).includes(proyectoId))))
      .map((p) => ({ uid: p.id, nombre: p.nombre || "Sin nombre" }));
  }, [profiles, cliente, proyectoId, user?.uid]);

  const q = normal(busca.trim());
  const grupos = useMemo(
    () =>
      chats
        .filter((c) => c.tipo !== "prodi" && c.tipo !== "directo")
        .map((c) => ({ c, nombre: tituloChat(c, user?.uid, profiles, role ?? undefined) }))
        .filter((x) => !q || normal(x.nombre).includes(q))
        .sort((a, b) => Number(b.c.proyecto_id === proyectoId) - Number(a.c.proyecto_id === proyectoId) || a.nombre.localeCompare(b.nombre))
        .slice(0, q ? 20 : 6),
    [chats, q, user?.uid, profiles, role, proyectoId]
  );
  const gente = personas.filter((p) => !q || normal(p.nombre).includes(q));

  const mandar = async () => {
    if (!destino || !user) return;
    setEnviando(true);
    try {
      let chat: Chat | undefined;
      if (destino.tipo === "chat") chat = chats.find((c) => c.id === destino.id);
      else {
        const yo = profile?.nombre || user.displayName || "Prodi";
        const id = await abrirDirecto(user.uid, destino.uid, { [user.uid]: yo, [destino.uid]: destino.nombre });
        chat = chats.find((c) => c.id === id) ?? ({ id, tipo: "directo", miembros: [user.uid, destino.uid].sort(), nombres: {} } as unknown as Chat);
      }
      if (!chat) throw new Error("No encontré ese chat");
      if (nota.trim()) await enviarMensaje(chat, user.uid, nota.trim(), { remitente: profile?.nombre ?? undefined });
      for (const v of videos) {
        await enviarMensaje(chat, user.uid, textoGuion(v), {
          remitente: profile?.nombre ?? undefined,
          referencia: { tipo: "video", id: v.id, titulo: v.titulo, detalle: "Guion" },
        });
      }
      toast.success(videos.length === 1 ? "Guion mandado" : `Mandados los ${videos.length} guiones`, {
        action: { label: "Ver chat", onClick: () => abrirEnDock(chat!.id) },
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mandar");
    } finally {
      setEnviando(false);
    }
  };

  const fila = (activo: boolean) =>
    cn(
      "flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-all",
      activo ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-transparent hover:bg-muted/60"
    );

  return (
    <Dialog open={open} onOpenChange={(v) => !enviando && onOpenChange(v)}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> {videos.length === 1 ? "Mandar el guion" : `Mandar ${videos.length} guiones`}
          </DialogTitle>
          <DialogDescription>
            {videos.length === 1 ? `“${videos[0].titulo}”` : videos.map((v) => v.titulo).join(" · ")}: lo que va a decir a cámara, con la tarjeta del video (las tomas no se mandan).
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar persona o grupo…" className="pl-9" />
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {gente.length > 0 && (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" /> Personas de {cliente?.nombre ?? "este cliente"}
              </p>
              {gente.map((p) => (
                <button key={p.uid} type="button" onClick={() => setDestino({ tipo: "persona", ...p })} className={fila(destino?.tipo === "persona" && destino.uid === p.uid)}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                    {p.nombre.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.nombre}</span>
                    <span className="block text-[11px] text-muted-foreground">Por privado</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Grupos
            </p>
            {grupos.map(({ c, nombre }) => (
              <button key={c.id} type="button" onClick={() => setDestino({ tipo: "chat", id: c.id })} className={fila(destino?.tipo === "chat" && destino.id === c.id)}>
                <ChatIcon chat={c} profiles={profiles} uid={user?.uid} className="h-9 w-9" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{nombre}</span>
                  <span className="block text-[11px] text-muted-foreground">{c.proyecto_id === proyectoId ? "Grupo de este cliente" : "Grupo"}</span>
                </span>
              </button>
            ))}
            {grupos.length === 0 && <p className="px-1 py-2 text-sm text-muted-foreground">No hay grupos con ese nombre.</p>}
          </div>
        </div>
        <Textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Mensaje (opcional): te paso el guion para el rodaje del jueves" />
        <Button onClick={() => void mandar()} disabled={!destino || enviando} className="w-full">
          {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Mandar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
