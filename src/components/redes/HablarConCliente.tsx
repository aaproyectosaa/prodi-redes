import { useNavigate, useSearchParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRedes } from "@/contexts/redes-data-context";
import { chatClienteId } from "@/lib/redes/chat";
import { abrirEnDock, prepararBorrador } from "@/lib/redes/chatDock";
import type { ReferenciaChat } from "@/lib/redes/types";

/**
 * "Hablarlo con el cliente": abre el grupo del cliente con la tarjeta del video o la pieza y la corrección
 * entera lista para mandar; solo falta escribir la pregunta o el aviso.
 */
export function HablarConCliente({ proyectoId, referencia, className, onAbrir }: { proyectoId: string; referencia: ReferenciaChat; className?: string; onAbrir?: () => void }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { chats } = useRedes();
  const id = chatClienteId(proyectoId);
  if (!chats.some((c) => c.id === id)) return null;
  const abrir = () => {
    prepararBorrador(id, { texto: "", referencia });
    // Se cierra el panel del video para que el chat flotante quede a la vista.
    if (params.has("video")) {
      const next = new URLSearchParams(params);
      next.delete("video");
      setParams(next, { replace: true });
    }
    onAbrir?.();
    if (!abrirEnDock(id)) navigate(`/chat?c=${id}`);
  };
  return (
    <Button size="sm" variant="outline" className={className} onClick={abrir}>
      <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Hablarlo con el cliente
    </Button>
  );
}
