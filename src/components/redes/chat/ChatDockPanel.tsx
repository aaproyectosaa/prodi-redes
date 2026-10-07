import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Maximize2, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useTareas } from "@/lib/redes/tareas";
import { ANCHO_PANEL, dock, LISTA, setSinLeerDock } from "@/lib/redes/chatDock";
import { ChatLista } from "@/components/redes/chat/ChatLista";
import { ChatConversacion } from "@/components/redes/chat/ChatConversacion";
import { TareasSheet } from "@/components/redes/chat/Tareas";
import { cn } from "@/lib/utils";

function Accion({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0 text-muted-foreground md:h-8 md:w-8" onClick={onClick} aria-label={label} title={label}>
      {children}
    </Button>
  );
}

/** Caja fija de un panel (la lista o una conversación): se oculta sin desmontarse. */
function Caja({
  id,
  desplegado,
  escritorio,
  derecha,
  tituloId,
  registrar,
  children,
}: {
  id: string;
  desplegado: boolean;
  escritorio: boolean;
  derecha: number;
  tituloId: string;
  registrar: (id: string, el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={(el) => registrar(id, el)}
      role="dialog"
      aria-labelledby={tituloId}
      aria-modal={escritorio ? undefined : true}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        dock.minimizar(id);
      }}
      style={escritorio ? { right: derecha, width: ANCHO_PANEL } : undefined}
      className={cn(
        "fixed flex flex-col overflow-hidden bg-background outline-none",
        escritorio
          ? "bottom-0 z-40 h-[min(560px,calc(100dvh-4rem))] max-w-[calc(100vw-2rem)] rounded-t-xl border border-b-0 shadow-2xl"
          : "alto-app seguro-costados z-50 safe-area-pt",
        // Se ve al instante al abrir (para poder enfocarlo) y se oculta recién al terminar la animación.
        desplegado
          ? "visible translate-y-0 opacity-100 [transition:transform_200ms,opacity_200ms]"
          : cn(
              "pointer-events-none invisible opacity-0 [transition:transform_200ms,opacity_200ms,visibility_0s_200ms]",
              escritorio ? "translate-y-4" : "translate-y-full"
            )
      )}
    >
      {children}
    </div>
  );
}

/**
 * Paneles del chat flotante: la lista y cada conversación abierta (se carga aparte).
 * Cada conversación queda montada mientras está abierta: minimizada no pierde lo escrito, el scroll, las subidas ni el audio.
 */
export default function ChatDockPaneles({
  abiertos,
  desplegados,
  derecha,
  escritorio,
  baseId,
  registrar,
}: {
  /** Conversaciones abiertas (solo las que existen). */
  abiertos: string[];
  /** Paneles a la vista (vacío en /chat). */
  desplegados: string[];
  /** Distancia al borde derecho de cada panel (compu). */
  derecha: Record<string, number>;
  escritorio: boolean;
  baseId: string;
  registrar: (id: string, el: HTMLDivElement | null) => void;
}) {
  const navigate = useNavigate();
  const { chats, clienteById, settings } = useRedes();
  const { profiles } = useAppData();
  const { user, role, profile } = useUserProfileContext();
  const uid = user?.uid;
  const tareas = useTareas(uid);
  const [verTareas, setVerTareas] = useState(false);
  const listaVisible = desplegados.includes(LISTA);
  // La lista se monta la primera vez que se abre.
  const [conLista, setConLista] = useState(listaVisible);
  useEffect(() => {
    if (listaVisible) setConLista(true);
  }, [listaVisible]);

  const pantallaCompleta = (id: string | null) => {
    dock.minimizar(id ?? LISTA);
    navigate(id ? `/chat?c=${id}` : "/chat");
  };

  const acciones = (id: string | null) =>
    escritorio ? (
      <>
        <Accion label="Abrir en pantalla completa" onClick={() => pantallaCompleta(id)}>
          <Maximize2 className="h-4 w-4" />
        </Accion>
        <Accion label="Minimizar" onClick={() => dock.minimizar(id ?? LISTA)}>
          <Minus className="h-4 w-4" />
        </Accion>
        {id && (
          <Accion label="Cerrar conversación" onClick={() => dock.cerrar(id)}>
            <X className="h-4 w-4" />
          </Accion>
        )}
      </>
    ) : (
      <Accion label="Minimizar" onClick={() => dock.minimizar(id ?? LISTA)}>
        <ChevronDown className="h-5 w-5" />
      </Accion>
    );

  const tituloDe = (id: string) => `${baseId}-${id}`;

  return (
    <>
      {conLista && (
        <Caja
          id={LISTA}
          desplegado={listaVisible}
          escritorio={escritorio}
          derecha={derecha[LISTA] ?? 16}
          tituloId={tituloDe(LISTA)}
          registrar={registrar}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatLista
              activoId={null}
              onAbrir={(id) => {
                dock.minimizar(LISTA);
                dock.abrir(id);
              }}
              onTareas={() => setVerTareas(true)}
              tareasPendientes={tareas.pendientes}
              compacto
              acciones={acciones(null)}
              tituloId={tituloDe(LISTA)}
            />
          </div>
        </Caja>
      )}
      {uid &&
        abiertos.map((id) => {
          const chat = chats.find((c) => c.id === id);
          if (!chat) return null;
          const activa = desplegados.includes(id);
          return (
            <Caja
              key={id}
              id={id}
              desplegado={activa}
              escritorio={escritorio}
              derecha={derecha[id] ?? 16}
              tituloId={tituloDe(id)}
              registrar={registrar}
            >
              <h2 id={tituloDe(id)} className="sr-only">
                Chat
              </h2>
              <ChatConversacion
                chat={chat}
                uid={uid}
                nombre={profile?.nombre ?? ""}
                profiles={profiles}
                role={role}
                onBack={() => {
                  dock.minimizar(id);
                  dock.lista();
                }}
                onTareas={() => setVerTareas(true)}
                jitsiBase={settings.jitsi_base}
                color={clienteById(chat.proyecto_id)?.color}
                activa={activa}
                compacto
                acciones={acciones(id)}
                onSinLeer={(n) => setSinLeerDock(id, n)}
              />
            </Caja>
          );
        })}
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
