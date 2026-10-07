import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Maximize2, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useTareas } from "@/lib/redes/tareas";
import { dock } from "@/lib/redes/chatDock";
import { ChatLista } from "@/components/redes/chat/ChatLista";
import { ChatConversacion } from "@/components/redes/chat/ChatConversacion";
import { TareasSheet } from "@/components/redes/chat/Tareas";

function Accion({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0 text-muted-foreground md:h-8 md:w-8" onClick={onClick} aria-label={label} title={label}>
      {children}
    </Button>
  );
}

/** Contenido del chat flotante: la lista o una conversación (se carga aparte, la primera vez que se abre). */
export default function ChatDockPanel({
  chatId,
  activa,
  escritorio,
  tituloId,
}: {
  chatId: string | null;
  /** El panel está desplegado y a la vista. */
  activa: boolean;
  escritorio: boolean;
  tituloId: string;
}) {
  const navigate = useNavigate();
  const { chats, clienteById, settings } = useRedes();
  const { profiles } = useAppData();
  const { user, role, profile } = useUserProfileContext();
  const uid = user?.uid;
  const tareas = useTareas(uid);
  const [verTareas, setVerTareas] = useState(false);
  const chat = chats.find((c) => c.id === chatId) ?? null;

  const pantallaCompleta = () => {
    dock.minimizar();
    navigate(chat ? `/chat?c=${chat.id}` : "/chat");
  };

  const acciones = escritorio ? (
    <>
      <Accion label="Abrir en pantalla completa" onClick={pantallaCompleta}>
        <Maximize2 className="h-4 w-4" />
      </Accion>
      <Accion label="Minimizar" onClick={dock.minimizar}>
        <Minus className="h-4 w-4" />
      </Accion>
      {chat && (
        <Accion label="Cerrar conversación" onClick={dock.cerrar}>
          <X className="h-4 w-4" />
        </Accion>
      )}
    </>
  ) : (
    <Accion label="Minimizar" onClick={dock.minimizar}>
      <ChevronDown className="h-5 w-5" />
    </Accion>
  );

  return (
    <>
      {chat && uid ? (
        <>
          <h2 id={tituloId} className="sr-only">
            Chat
          </h2>
          <ChatConversacion
            key={chat.id}
            chat={chat}
            uid={uid}
            nombre={profile?.nombre ?? ""}
            profiles={profiles}
            role={role}
            onBack={dock.lista}
            onTareas={() => setVerTareas(true)}
            jitsiBase={settings.jitsi_base}
            color={clienteById(chat.proyecto_id)?.color}
            activa={activa}
            compacto
            acciones={acciones}
          />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatLista
            activoId={null}
            onAbrir={(id) => dock.abrir(id)}
            onTareas={() => setVerTareas(true)}
            tareasPendientes={tareas.pendientes}
            compacto
            acciones={acciones}
            tituloId={tituloId}
          />
        </div>
      )}
      {uid && (
        <TareasSheet
          open={verTareas}
          onOpenChange={setVerTareas}
          uid={uid}
          profiles={profiles}
          mias={tareas.mias}
          pedidas={tareas.pedidas}
          onIrAlChat={(id) => {
            setVerTareas(false);
            dock.abrir(id);
          }}
        />
      )}
    </>
  );
}
