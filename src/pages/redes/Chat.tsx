import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useTareas } from "@/lib/redes/tareas";
import { ChatLista } from "@/components/redes/chat/ChatLista";
import { ChatConversacion } from "@/components/redes/chat/ChatConversacion";
import { TareasSheet } from "@/components/redes/chat/Tareas";
import { cn } from "@/lib/utils";

export default function Chat() {
  const { chats, clienteById, settings } = useRedes();
  const { profiles } = useAppData();
  const { user, role, profile } = useUserProfileContext();
  const uid = user?.uid;
  const [params, setParams] = useSearchParams();
  const activoId = params.get("c");
  const activo = chats.find((c) => c.id === activoId) ?? null;
  const tareas = useTareas(uid);
  const verTareas = params.get("tareas") === "1";

  const abrir = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("c", id);
    else next.delete("c");
    next.delete("tareas");
    setParams(next, { replace: !!activoId });
  };
  const setVerTareas = (v: boolean) => {
    const next = new URLSearchParams(params);
    if (v) next.set("tareas", "1");
    else next.delete("tareas");
    setParams(next, { replace: true });
  };

  // En escritorio, abrir la primera conversación si no hay ninguna elegida.
  useEffect(() => {
    if (!activoId && chats.length && window.matchMedia("(min-width: 768px)").matches) abrir(chats[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats.length, activoId]);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Lista */}
      <aside
        className={cn(
          "flex min-h-0 w-full flex-col border-r md:w-80 md:shrink-0",
          activo && "hidden md:flex"
        )}
      >
        <ChatLista
          activoId={activoId}
          onAbrir={abrir}
          onTareas={() => setVerTareas(true)}
          tareasPendientes={tareas.pendientes}
        />
      </aside>

      {/* Conversación */}
      <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !activo && "hidden md:flex")}>
        {activo && uid ? (
          <ChatConversacion
            key={activo.id}
            chat={activo}
            uid={uid}
            nombre={profile?.nombre ?? ""}
            profiles={profiles}
            role={role}
            onBack={() => abrir(null)}
            onTareas={() => setVerTareas(true)}
            jitsiBase={settings.jitsi_base}
            color={clienteById(activo.proyecto_id)?.color}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageCircle className="h-10 w-10 opacity-40" />
            <p className="text-sm">Elegí una conversación</p>
          </div>
        )}
      </section>

      {uid && (
        <TareasSheet
          open={verTareas}
          onOpenChange={setVerTareas}
          uid={uid}
          profiles={profiles}
          mias={tareas.mias}
          pedidas={tareas.pedidas}
          onIrAlChat={(id) => abrir(id)}
        />
      )}
    </div>
  );
}
