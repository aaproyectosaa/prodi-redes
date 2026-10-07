import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { List, Loader2, MessageCircle, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTecladoAbierto } from "@/components/MobileNav";
import { noLeido, tituloChat } from "@/lib/redes/chat";
import { ChatIcon } from "./ChatIcon";
import { abrirEnDock, ANCHO_PANEL, chatDeLink, dock, LISTA, useChatDock, useSinLeerDock } from "@/lib/redes/chatDock";
import { cn } from "@/lib/utils";
import type { Chat as ChatT } from "@/lib/redes/types";

const ChatDockPaneles = lazy(() => import("./ChatDockPanel"));

/** Los mismos roles que entran a /chat. */
const ROLES_CHAT = ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"];

// Medidas de la fila de abajo (compu), en px.
const MARGEN = 16;
const SEP = 8;
const ANCHO_PILDORA = 224;
const ANCHO_CHATS = 132;
const ANCHO_MAS = 60;
/** Lo que queda libre a la izquierda (menú lateral). */
const RESERVA = 272;

const PILDORA =
  "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex h-12 items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40 ring-1 ring-white/20 transition-[right,transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/50";

function useAnchoVentana() {
  const [ancho, setAncho] = useState(() => window.innerWidth);
  useEffect(() => {
    const medir = () => setAncho(window.innerWidth);
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  return ancho;
}

function Badge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground",
        className
      )}
    >
      {n > 9 ? "9+" : n}
    </span>
  );
}

/**
 * Chat flotante. En la compu: una burbuja por conversación abierta (hasta 4) a lo largo de abajo, más "Chats" a la derecha;
 * cada una se despliega en su lugar y, si hay espacio, varias a la vez. En el celular: un botón que muestra las abiertas
 * para saltar entre ellas, cada una a pantalla completa.
 * Se monta una sola vez en el layout: al cambiar de pantalla no pierde lo escrito, el audio ni las subidas.
 */
export function ChatDock() {
  const { pathname, search } = useLocation();
  const { user, role, viewingAs } = useUserProfileContext();
  const { chats, chatsNoLeidos, clienteById } = useRedes();
  const { profiles } = useAppData();
  const estado = useChatDock();
  const sinLeer = useSinLeerDock();
  const escritorio = !useIsMobile();
  const teclado = useTecladoAbierto();
  const ancho = useAnchoVentana();
  const baseId = useId();
  const paneles = useRef(new Map<string, HTMLDivElement>());
  const pildoras = useRef(new Map<string, HTMLElement>());
  const botonChats = useRef<HTMLButtonElement>(null);
  const botonMas = useRef<HTMLButtonElement>(null);
  const [selector, setSelector] = useState(false);
  const elegido = useRef(false);
  const uid = user?.uid;

  // "Ver como" es solo lectura: el chat flotante no aparece.
  const habilitado = !!user && !viewingAs && ROLES_CHAT.includes(role ?? "") && chats.length > 0;
  const enChat = pathname.replace(/\/$/, "") === "/chat";
  const visible = habilitado && !enChat;
  const chatDe = (id: string): ChatT | undefined => chats.find((c) => c.id === id);
  const abiertos = estado.abiertos.filter((id) => chats.some((c) => c.id === id));
  const desplegados = visible ? estado.desplegados : [];
  const algoDesplegado = desplegados.length > 0;

  // Cuántos paneles entran uno al lado del otro.
  const disponible = Math.max(0, ancho - MARGEN - RESERVA);
  const capacidad = escritorio ? Math.min(3, Math.max(1, Math.floor((disponible + SEP) / (ANCHO_PANEL + SEP)))) : 1;
  useEffect(() => {
    dock.setCapacidad(capacidad);
  }, [capacidad]);

  useEffect(() => {
    dock.setDisponible(visible);
    return () => dock.setDisponible(false);
  }, [visible]);

  // Las conversaciones a las que ya no tiene acceso salen solas (las nuevas todavía pueden no haber llegado).
  const chatsAntes = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!chats.length) return;
    const ahora = new Set(chats.map((c) => c.id));
    const antes = chatsAntes.current;
    chatsAntes.current = ahora;
    dock.quitar((id) => !ahora.has(id) && (!antes || antes.has(id)));
  }, [chats]);

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

  // Los paneles se cargan la primera vez que hacen falta y después quedan montados (no pierden el estado).
  const [montado, setMontado] = useState(false);
  useEffect(() => {
    if (visible && (algoDesplegado || abiertos.length > 0)) setMontado(true);
  }, [visible, algoDesplegado, abiertos.length]);

  useEffect(() => {
    if (algoDesplegado || teclado || !visible || escritorio) setSelector(false);
  }, [algoDesplegado, teclado, visible, escritorio]);

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

  // Foco: al desplegar va al panel (en la compu, directo a escribir); al minimizar vuelve a su burbuja.
  const previo = useRef<string[]>([]);
  useEffect(() => {
    const ahora = visible ? estado.desplegados : [];
    const antes = previo.current;
    previo.current = ahora;
    const frente = ahora[0];
    if (frente && frente !== antes[0] && ahora.length >= antes.length) {
      // La primera vez el contenido se carga aparte, y el panel tarda un instante en ser visible: se reintenta.
      let intentos = 0;
      const enfocar = () => {
        const el = paneles.current.get(frente);
        const campo = escritorio
          ? (el?.querySelector<HTMLElement>("textarea") ?? el?.querySelector<HTMLElement>("input:not([type=file]):not([type=hidden])"))
          : null;
        const destino = campo ?? (escritorio && intentos < 20 ? null : el);
        destino?.focus({ preventScroll: true });
        if ((!destino || document.activeElement !== destino) && intentos++ < 30) t = setTimeout(enfocar, 50);
      };
      let t = setTimeout(enfocar, 0);
      return () => clearTimeout(t);
    }
    const salieron = antes.filter((id) => !ahora.includes(id));
    if (!salieron.length || !visible) return;
    const activo = document.activeElement;
    const enPanel = !activo || activo === document.body || salieron.some((id) => paneles.current.get(id)?.contains(activo));
    if (!enPanel) return;
    const t = setTimeout(() => {
      const id = salieron[0];
      const destino = (escritorio && id !== LISTA ? (pildoras.current.get(id) ?? botonMas.current) : null) ?? botonChats.current;
      destino?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(t);
  }, [estado.desplegados, escritorio, visible]);

  const registrarPanel = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) paneles.current.set(id, el);
    else paneles.current.delete(id);
  }, []);

  if (!habilitado) return null;

  const titulo = (c: ChatT) => tituloChat(c, uid, profiles, role);
  /** Sin leer de una conversación abierta (si todavía no se contó, al menos 1 si tiene algo nuevo). */
  const sinLeerDe = (c: ChatT) => sinLeer[c.id] ?? (noLeido(c, uid) ? 1 : 0);
  const icono = (c: ChatT, className: string) => (
    <ChatIcon chat={c} profiles={profiles} uid={uid} color={clienteById(c.proyecto_id)?.color} className={className} />
  );

  // ---- Compu: qué burbujas entran y dónde va cada una ----
  const listaDesplegada = desplegados.includes(LISTA);
  const anchoChats = listaDesplegada ? ANCHO_PANEL : ANCHO_CHATS;
  const expandidas = abiertos.filter((id) => desplegados.includes(id));
  const minimizadas = abiertos.filter((id) => !desplegados.includes(id));
  let resto = disponible - anchoChats - SEP - expandidas.length * (ANCHO_PANEL + SEP);
  const enFila = new Set(expandidas);
  const enMas: string[] = [];
  minimizadas.forEach((id, i) => {
    const entranTodas = resto >= (minimizadas.length - i) * (ANCHO_PILDORA + SEP);
    if (!enMas.length && (entranTodas || resto >= ANCHO_PILDORA + SEP + ANCHO_MAS + SEP)) {
      enFila.add(id);
      resto -= ANCHO_PILDORA + SEP;
    } else enMas.push(id);
  });
  const derecha: Record<string, number> = { [LISTA]: MARGEN };
  let x = MARGEN + anchoChats + SEP;
  for (const id of abiertos) {
    if (!enFila.has(id)) continue;
    derecha[id] = x;
    x += (desplegados.includes(id) ? ANCHO_PANEL : ANCHO_PILDORA) + SEP;
  }
  const derechaMas = x;

  const etiquetaChats = `Abrir la lista de chats${chatsNoLeidos ? ` (${chatsNoLeidos} sin leer)` : ""}`;
  const masSinLeer = enMas.reduce((s, id) => s + (chatDe(id) ? sinLeerDe(chatDe(id)!) : 0), 0);

  const escritorioFila = visible && escritorio && (
    <>
      {!listaDesplegada && (
        <button
          ref={botonChats}
          type="button"
          onClick={() => dock.lista()}
          aria-label={etiquetaChats}
          aria-expanded={false}
          title="Chats"
          style={{ right: MARGEN, width: ANCHO_CHATS }}
          className={cn(PILDORA, "gap-2 pl-2 pr-3")}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-primary-foreground">
            <List className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-semibold">Chats</span>
          <Badge n={chatsNoLeidos} className="ml-auto" />
        </button>
      )}
      {minimizadas
        .filter((id) => enFila.has(id))
        .map((id) => {
          const c = chatDe(id)!;
          const n = sinLeerDe(c);
          const t = titulo(c);
          return (
            <div key={id} style={{ right: derecha[id], width: ANCHO_PILDORA }} className={PILDORA}>
              <button
                ref={(el) => {
                  if (el) pildoras.current.set(id, el);
                  else pildoras.current.delete(id);
                }}
                type="button"
                onClick={() => dock.abrir(id)}
                aria-label={`Abrir chat: ${t}${n ? ` (${n} sin leer)` : ""}`}
                aria-expanded={false}
                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-full pl-2 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {icono(c, "h-8 w-8 ring-2 ring-white/30")}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t}</span>
                <Badge n={n} />
              </button>
              <button
                type="button"
                onClick={() => {
                  dock.cerrar(id);
                  setTimeout(() => botonChats.current?.focus({ preventScroll: true }), 0);
                }}
                aria-label={`Cerrar chat: ${t}`}
                title="Cerrar conversación"
                className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-primary-foreground/80 outline-none hover:bg-white/20 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      {enMas.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              ref={botonMas}
              type="button"
              aria-label={`${enMas.length === 1 ? "1 chat abierto más" : `${enMas.length} chats abiertos más`}${masSinLeer ? ` (${masSinLeer} sin leer)` : ""}`}
              title="Más chats abiertos"
              style={{ right: derechaMas, width: ANCHO_MAS }}
              className={cn(PILDORA, "justify-center text-sm font-bold")}
            >
              +{enMas.length}
              {masSinLeer > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-destructive ring-2 ring-background" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            className="w-60"
            // Al elegir una, el foco va a su panel (no vuelve a "+N").
            onCloseAutoFocus={(e) => {
              if (!elegido.current) return;
              elegido.current = false;
              e.preventDefault();
            }}
          >
            {enMas.map((id) => {
              const c = chatDe(id)!;
              const n = sinLeerDe(c);
              return (
                <DropdownMenuItem
                  key={id}
                  onSelect={() => {
                    elegido.current = true;
                    dock.traer(id);
                  }}
                  className="gap-2"
                >
                  {icono(c, "h-7 w-7")}
                  <span className="min-w-0 flex-1 truncate">{titulo(c)}</span>
                  <Badge n={n} />
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  // ---- Celular: botón flotante y selector de chats abiertos ----
  const abrirDesdeBoton = () => (abiertos.length ? setSelector((v) => !v) : dock.lista());
  const celular = visible && !escritorio && !algoDesplegado && !teclado && (
    <>
      {selector && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSelector(false)} aria-hidden />
          <div
            role="menu"
            aria-label="Chats abiertos"
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              setSelector(false);
              botonChats.current?.focus({ preventScroll: true });
            }}
            style={{ bottom: "calc(var(--alto-barra) + 4.75rem + 3.75rem)" }}
            className="fixed right-[calc(0.75rem+env(safe-area-inset-right))] z-40 flex max-w-[calc(100vw-1.5rem-env(safe-area-inset-left)-env(safe-area-inset-right))] flex-col items-end gap-2.5"
          >
            {abiertos.map((id, i) => {
              const c = chatDe(id)!;
              const n = sinLeerDe(c);
              const t = titulo(c);
              return (
                <div key={id} className="flex max-w-full items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => dock.cerrar(id)}
                    aria-label={`Cerrar chat: ${t}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-md active:scale-95"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    autoFocus={i === 0}
                    onClick={() => {
                      setSelector(false);
                      dock.abrir(id);
                    }}
                    aria-label={`Abrir chat: ${t}${n ? ` (${n} sin leer)` : ""}`}
                    className="flex min-w-0 items-center gap-2 active:scale-95"
                  >
                    <span className="min-w-0 truncate rounded-full border bg-background px-3 py-1.5 text-sm font-medium shadow-md">{t}</span>
                    <span className="relative shrink-0">
                      {icono(c, "h-12 w-12 shadow-lg ring-2 ring-background")}
                      <Badge n={n} className="absolute -right-1 -top-1" />
                    </span>
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSelector(false);
                dock.lista();
              }}
              className="flex items-center gap-2 active:scale-95"
            >
              <span className="rounded-full border bg-background px-3 py-1.5 text-sm font-semibold shadow-md">Todos los chats</span>
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-background">
                <List className="h-5 w-5" />
                <Badge n={chatsNoLeidos} className="absolute -right-1 -top-1" />
              </span>
            </button>
          </div>
        </>
      )}
      <button
        ref={botonChats}
        type="button"
        onClick={abrirDesdeBoton}
        aria-label={abiertos.length ? `Chats abiertos${chatsNoLeidos ? ` (${chatsNoLeidos} sin leer)` : ""}` : `Abrir chat${chatsNoLeidos ? ` (${chatsNoLeidos} sin leer)` : ""}`}
        aria-expanded={abiertos.length ? selector : false}
        aria-haspopup={abiertos.length ? "menu" : undefined}
        // Por encima de la barra de abajo y de las barras de "Guardar" que quedan pegadas abajo.
        style={{ bottom: "calc(var(--alto-barra) + 4.75rem)" }}
        className={cn(
          "fixed right-[calc(0.75rem+env(safe-area-inset-right))] flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95",
          selector ? "z-40" : "z-30"
        )}
      >
        {selector ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        {!selector && <Badge n={chatsNoLeidos} className="absolute -right-1 -top-1" />}
        {!selector && abiertos.length > 0 && (
          <span className="absolute -bottom-1 -left-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1 text-[10px] font-bold text-primary shadow ring-1 ring-primary/30">
            {abiertos.length}
          </span>
        )}
      </button>
    </>
  );

  const frente = desplegados[0];
  return (
    <>
      {escritorioFila}
      {celular}
      {montado && (
        <Suspense
          fallback={
            frente ? (
              <div
                style={escritorio ? { right: derecha[frente] ?? MARGEN, width: ANCHO_PANEL } : undefined}
                className={cn(
                  "fixed flex items-center justify-center bg-background",
                  escritorio
                    ? "bottom-0 z-40 h-[min(560px,calc(100dvh-4rem))] max-w-[calc(100vw-2rem)] rounded-t-xl border border-b-0 shadow-2xl"
                    : "alto-app z-50"
                )}
              >
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : null
          }
        >
          <ChatDockPaneles
            abiertos={abiertos}
            desplegados={desplegados}
            derecha={derecha}
            escritorio={escritorio}
            baseId={baseId}
            registrar={registrarPanel}
          />
        </Suspense>
      )}
    </>
  );
}
