import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircle, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatIcon } from "@/components/redes/chat/ChatIcon";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { tituloChat } from "@/lib/redes/chat";
import { abrirEnDock } from "@/lib/redes/chatDock";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * "Mandar por chat": elegís a quién (una persona, un grupo o el chat del cliente) y le llega la imagen de la
 * versión con la tarjeta de la pieza. Primero aparece el grupo de ese cliente.
 */
export function CompartirPorChat({
  open,
  onOpenChange,
  piezaId,
  versionId,
  proyectoId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  piezaId: string;
  versionId: string | null;
  proyectoId: string;
}) {
  const { chats } = useRedes();
  const { profiles } = useAppData();
  const { user, role } = useUserProfileContext();
  const [busca, setBusca] = useState("");
  const [elegido, setElegido] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusca("");
    setTexto("");
    setElegido(null);
  }, [open]);

  const lista = useMemo(() => {
    const q = normal(busca.trim());
    return chats
      .filter((c) => c.tipo !== "prodi")
      .map((c) => ({ c, nombre: tituloChat(c, user?.uid, profiles, role ?? undefined) }))
      .filter((x) => !q || normal(x.nombre).includes(q))
      .sort((a, b) => Number(b.c.proyecto_id === proyectoId) - Number(a.c.proyecto_id === proyectoId) || a.nombre.localeCompare(b.nombre));
  }, [chats, busca, user?.uid, profiles, role, proyectoId]);

  const mandar = async () => {
    if (!elegido || !versionId) return;
    setEnviando(true);
    try {
      await callApi("/api/ia/pieza-compartir", { pieza_id: piezaId, version_id: versionId, chat_id: elegido, texto });
      toast.success("Mandada por chat", { action: { label: "Ver chat", onClick: () => abrirEnDock(elegido) } });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mandar");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !enviando && onOpenChange(v)}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" /> Mandar por chat
          </DialogTitle>
          <DialogDescription>Le llega la imagen con la tarjeta de la pieza.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar persona o grupo…" className="pl-9" autoFocus />
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {lista.map(({ c, nombre }) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setElegido(c.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-all",
                elegido === c.id ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-transparent hover:bg-muted/60"
              )}
            >
              <ChatIcon chat={c} profiles={profiles} uid={user?.uid} className="h-9 w-9" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{nombre}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {c.proyecto_id === proyectoId ? "Grupo de este cliente" : c.tipo === "directo" ? "Privado" : c.tipo === "equipo" ? "Equipo" : "Grupo"}
                </span>
              </span>
            </button>
          ))}
          {lista.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No hay chats con ese nombre.</p>}
        </div>
        <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Mensaje (opcional): ¿te gusta así?" />
        <Button onClick={() => void mandar()} disabled={!elegido || !versionId || enviando} className="w-full">
          {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Mandar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
