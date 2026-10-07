import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, MessageCircle } from "lucide-react";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTecladoAbierto } from "@/components/MobileNav";
import { tituloChat } from "@/lib/redes/chat";
import { ChatIcon } from "./ChatIcon";
import { abrirEnDock, chatDeLink, dock, useChatDock } from "@/lib/redes/chatDock";
import { cn } from "@/lib/utils";

const ChatDockPanel = lazy(() => import("./ChatDockPanel"));

/** Los mismos roles que entran a /chat. */
const ROLES_CHAT = ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"];

/**
 * Chat flotante: abajo a la derecha (en el celular, un botón que abre el chat a pantalla completa).
 * Se monta una sola vez en el layout: al cambiar de pantalla no pierde lo escrito, el audio ni las subidas.
 */
export function ChatDock() {
  const { pathname, search } = useLocation();
  const { user, role, viewingAs } = useUserProfileContext();
  const { chats, chatsNoLeidos, clienteById } = useRedes();
  const { profiles } = useAppData();
  const estado = useChatDock();
  const escritorio = !useIsMobile();
  const teclado = useTecladoAbierto();
  const tituloId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  // "Ver como" es solo lectura: el chat flotante no aparece.
  const habilitado = !!user && !viewingAs && ROLES_CHAT.includes(role ?? "") && chats.length > 0;
  const enChat = pathname.replace(/\/$/, "") === "/chat";
  const visible = habilitado && !enChat;
  const desplegado = visible && estado.abierto;
  const chat = chats.find((c) => c.id === estado.chatId) ?? null;

  // El panel se carga la primera vez que se abre y después queda montado (no pierde el estado).
  const [montado, setMontado] = useState(estado.abierto);
  useEffect(() => {
    if (desplegado) setMontado(true);
  }, [desplegado]);

  useEffect(() => {
    dock.setDisponible(visible);
    return () => dock.setDisponible(false);
  }, [visible]);

  // Al salir de /chat, la conversación que estaba abierta queda minimizada acá.
  const ultimoC = useRef<string | null>(null);
  useEffect(() => {
    if (enChat) {
      ultimoC.current = new URLSearchParams(search).get("c");
      return;
    }
    if (ultimoC.current) {
      dock.recordar(ultimoC.current);
      ultimoC.current = null;
    }
  }, [enChat, search]);

  // Los links a /chat?c=… dentro del sistema abren la conversación acá, sin salir de la pantalla.
  useEffect(() => {
    if (!visible) return;
    const alTocar = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      if (!abrirEnDock(chatDeLink(a.href))) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", alTocar, true);
    return () => document.removeEventListener("click", alTocar, true);
  }, [visible]);

  // Foco: al abrir va al panel (en la compu, directo a escribir); al minimizar vuelve al botón.
  const previo = useRef({ desplegado, chatId: estado.chatId });
  useEffect(() => {
    const antes = previo.current;
    previo.current = { desplegado, chatId: estado.chatId };
    if (desplegado && (!antes.desplegado || antes.chatId !== estado.chatId)) {
      // La primera vez el contenido se carga aparte, y el panel tarda un instante en ser visible: se reintenta.
      let intentos = 0;
      const enfocar = () => {
        const el = panel.current;
        const campo = escritorio
          ? (el?.querySelector<HTMLElement>("textarea") ?? el?.querySelector<HTMLElement>("input:not([type=file]):not([type=hidden])"))
          : null;
        const destino = campo ?? (escritorio && intentos < 20 ? null : el);
        destino?.focus({ preventScroll: true });
        if ((!destino || document.activeElement !== destino) && intentos++ < 30) t = setTimeout(enfocar, 50);
      };
      let t = setTimeout(enfocar, 0);
      return () => clearTimeout(t);
    } else if (!desplegado && antes.desplegado && visible) {
      const enPanel = !document.activeElement || document.activeElement === document.body || panel.current?.contains(document.activeElement);
      if (enPanel) {
        const t = setTimeout(() => boton.current?.focus({ preventScroll: true }), 0);
        return () => clearTimeout(t);
      }
    }
  }, [desplegado, estado.chatId, escritorio, visible]);

  if (!habilitado) return null;

  const titulo = chat ? tituloChat(chat, user?.uid, profiles, role) : "Chat";
  const badge =
    chatsNoLeidos > 0 ? (
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
        {chatsNoLeidos > 9 ? "9+" : chatsNoLeidos}
      </span>
    ) : null;
  const etiqueta = `Abrir chat${chat ? `: ${titulo}` : ""}${chatsNoLeidos ? ` (${chatsNoLeidos} sin leer)` : ""}`;

  return (
    <>
      {visible && !estado.abierto &&
        (escritorio ? (
          <button
            ref={boton}
            type="button"
            onClick={() => dock.abrir()}
            aria-label={etiqueta}
            aria-expanded={false}
            className="fixed bottom-4 right-4 z-40 flex h-12 max-w-[16rem] items-center gap-2 rounded-full bg-primary pl-2 pr-4 text-primary-foreground shadow-lg shadow-primary/40 ring-1 ring-white/20 transition-all hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/50"
          >
            {chat ? (
              <ChatIcon chat={chat} profiles={profiles} uid={user?.uid} color={clienteById(chat.proyecto_id)?.color} className="h-8 w-8 ring-2 ring-white/30" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-primary-foreground">
                <MessageCircle className="h-4 w-4" />
              </span>
            )}
            <span className="truncate text-sm font-semibold">{titulo}</span>
            {badge}
          </button>
        ) : (
          !teclado && (
            <button
              ref={boton}
              type="button"
              onClick={() => dock.abrir()}
              aria-label={etiqueta}
              aria-expanded={false}
              // Por encima de la barra de abajo y de las barras de "Guardar" que quedan pegadas abajo.
              style={{ bottom: "calc(var(--alto-barra) + 4.75rem)" }}
              className="fixed right-3 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95"
            >
              <MessageCircle className="h-5 w-5" />
              {badge && <span className="absolute -right-1 -top-1">{badge}</span>}
            </button>
          )
        ))}

      {montado && (
        <div
          ref={panel}
          role="dialog"
          aria-labelledby={tituloId}
          aria-modal={escritorio ? undefined : true}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key !== "Escape" || e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return;
            e.preventDefault();
            dock.minimizar();
          }}
          className={cn(
            "fixed flex flex-col overflow-hidden bg-background outline-none",
            escritorio
              ? "bottom-0 right-4 z-40 h-[min(560px,calc(100dvh-4rem))] w-[380px] max-w-[calc(100vw-2rem)] rounded-t-xl border border-b-0 shadow-2xl"
              : "inset-0 z-50 safe-area-pt",
            // Se ve al instante al abrir (para poder enfocarlo) y se oculta recién al terminar la animación.
            desplegado
              ? "visible translate-y-0 opacity-100 [transition:transform_200ms,opacity_200ms]"
              : cn(
                  "pointer-events-none invisible opacity-0 [transition:transform_200ms,opacity_200ms,visibility_0s_200ms]",
                  escritorio ? "translate-y-4" : "translate-y-full"
                )
          )}
        >
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ChatDockPanel chatId={chat?.id ?? null} activa={desplegado} escritorio={escritorio} tituloId={tituloId} />
          </Suspense>
        </div>
      )}
    </>
  );
}
