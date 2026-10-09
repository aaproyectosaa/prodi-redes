import { useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRedes } from "@/contexts/redes-data-context";
import { chatClienteId } from "@/lib/redes/chat";
import { abrirEnDock, prepararBorrador } from "@/lib/redes/chatDock";

/**
 * "Hablarlo con el cliente": abre el grupo del cliente con el mensaje empezado sobre esa corrección
 * (qué video o pieza y el pedido), para preguntarle o avisarle sin salir a buscar el chat.
 */
export function HablarConCliente({ proyectoId, que, pedido, className }: { proyectoId: string; que: string; pedido: string; className?: string }) {
  const navigate = useNavigate();
  const { chats } = useRedes();
  const id = chatClienteId(proyectoId);
  if (!chats.some((c) => c.id === id)) return null;
  const abrir = () => {
    const primera = pedido.split("\n").map((l) => l.trim()).find((l) => l && !/:$/.test(l)) ?? pedido.trim();
    const cita = primera.replace(/^[-•*]\s*/, "").slice(0, 90);
    prepararBorrador(id, `Sobre ${que}, lo que pediste${cita ? ` (“${cita}${primera.length > 90 ? "…" : ""}”)` : ""}: `);
    if (!abrirEnDock(id)) navigate(`/chat?c=${id}`);
  };
  return (
    <Button size="sm" variant="outline" className={className} onClick={abrir}>
      <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Hablarlo con el cliente
    </Button>
  );
}
