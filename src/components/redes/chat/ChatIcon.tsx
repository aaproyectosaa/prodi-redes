import { Users } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useRedes } from "@/contexts/redes-data-context";
import { cn } from "@/lib/utils";
import type { Chat as ChatT } from "@/lib/redes/types";
import type { Profile } from "@/integrations/firebase/types";

/** Miniatura del logo del cliente en Drive (los de ejemplo no tienen). */
const logoUrl = (fileId: string) => (fileId.startsWith("demo/") || fileId.startsWith("blob:") ? undefined : `https://drive.google.com/thumbnail?id=${fileId}&sz=w128`);

/**
 * Foto de la conversación: la persona (privados), la foto del grupo o, en los de cada cliente, su logo.
 * Sin foto: emoji / iniciales sobre el color del grupo o del cliente.
 */
export function ChatIcon({
  chat,
  profiles,
  uid,
  color,
  className,
}: {
  chat: ChatT;
  profiles: Profile[];
  uid?: string;
  color?: string;
  className?: string;
}) {
  const { clienteById } = useRedes();
  const tam = className ?? "h-10 w-10";
  if (chat.tipo === "directo") {
    const otroId = chat.miembros.find((m) => m !== uid) ?? "";
    const otro =
      profiles.find((p) => p.id === otroId) ??
      (chat.nombres?.[otroId] ? ({ id: otroId, nombre: chat.nombres[otroId], email: "" } as Profile) : undefined);
    return otro ? <UserAvatar profile={otro} className={tam} /> : <div className={cn("shrink-0 rounded-full bg-muted", tam)} />;
  }
  const logo = chat.tipo === "cliente" ? clienteById(chat.proyecto_id)?.marca_archivos?.logo?.drive_file_id : undefined;
  const src = chat.foto || (logo ? logoUrl(logo) : undefined);
  const fondo = chat.tipo === "grupo" ? chat.color || "#6F40FC" : chat.tipo === "equipo" ? "#6F40FC" : color || "#6F40FC";
  return (
    <Avatar className={cn("shrink-0", tam)}>
      {src && (
        <AvatarImage
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className={cn(chat.foto ? "object-cover" : "bg-white object-contain p-1")}
        />
      )}
      <AvatarFallback className="text-sm font-bold text-white" style={{ backgroundColor: fondo }}>
        {chat.tipo === "equipo" ? (
          <Users className="h-1/2 w-1/2" />
        ) : chat.tipo === "grupo" && chat.emoji ? (
          <span className="text-lg leading-none">{chat.emoji}</span>
        ) : (
          (chat.nombre ?? "?").slice(0, 2).toUpperCase()
        )}
      </AvatarFallback>
    </Avatar>
  );
}

