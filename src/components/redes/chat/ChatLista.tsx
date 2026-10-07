import { useMemo, useState, type ReactNode, type Ref } from "react";
import { ListTodo, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { abrirDirecto, noLeido, PRODI_ID, tituloChat } from "@/lib/redes/chat";
import { getRoleInfo } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { fechaAR, formatearFecha, hoyAR } from "@/lib/fecha";
import type { Chat as ChatT } from "@/lib/redes/types";
import type { Profile } from "@/integrations/firebase/types";

function horaCorta(iso: string) {
  if (fechaAR(iso) === hoyAR()) return formatearFecha(iso, { hour: "2-digit", minute: "2-digit" });
  return formatearFecha(iso, { day: "numeric", month: "short" });
}

export function ChatIcon({ chat, profiles, uid, color }: { chat: ChatT; profiles: Profile[]; uid?: string; color?: string }) {
  if (chat.tipo === "directo") {
    const otro = profiles.find((p) => p.id === chat.miembros.find((m) => m !== uid));
    return otro ? <UserAvatar profile={otro} size="md" /> : <div className="h-10 w-10 rounded-full bg-muted" />;
  }
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
      style={{ backgroundColor: chat.tipo === "equipo" ? "#6F40FC" : color || "#6F40FC" }}
    >
      {chat.tipo === "equipo" ? <Users className="h-5 w-5" /> : (chat.nombre ?? "?").slice(0, 2).toUpperCase()}
    </div>
  );
}

/** Lista de conversaciones con buscador y "Nuevo" (la usan /chat y el chat flotante). */
export function ChatLista({
  activoId,
  onAbrir,
  onTareas,
  tareasPendientes,
  compacto,
  acciones,
  tituloId,
  buscarRef,
}: {
  activoId: string | null;
  onAbrir: (id: string) => void;
  onTareas: () => void;
  tareasPendientes: number;
  /** En el chat flotante: botones solo con ícono y sin el espacio de la barra del celular. */
  compacto?: boolean;
  /** Botones extra en el encabezado (minimizar, pantalla completa). */
  acciones?: ReactNode;
  tituloId?: string;
  buscarRef?: Ref<HTMLInputElement>;
}) {
  const { chats, clienteById, clientes } = useRedes();
  const { profiles } = useAppData();
  const { user, role, profile } = useUserProfileContext();
  const uid = user?.uid;
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(false);

  const lista = chats.filter((c) =>
    !q ? true : tituloChat(c, uid, profiles, role).toLowerCase().includes(q.toLowerCase())
  );

  // Con quién puede iniciar una conversación privada.
  const contactos = useMemo(() => {
    if (role === "cliente") {
      const ids = new Set(
        clientes.flatMap((c) => [...(c.team_roles?.productor ?? []), ...(c.team_roles?.pauta ?? []), ...(c.team_roles?.editor ?? [])])
      );
      profiles.filter((p) => p.role === "admin").forEach((p) => ids.add(p.id));
      return profiles.filter((p) => ids.has(p.id) && p.id !== uid);
    }
    return profiles.filter((p) => p.id !== uid && p.role && p.role !== "pending" && !["cm", "pm", "disenador"].includes(p.role));
  }, [role, clientes, profiles, uid]);

  const Titulo = compacto ? "h2" : "h1";

  return (
    <>
      <div className={cn("space-y-3 border-b", compacto ? "p-3" : "p-4")}>
        <div className="flex items-center justify-between gap-2">
          <Titulo id={tituloId} className={cn("font-bold", compacto ? "text-base" : "text-xl")}>
            Chat
          </Titulo>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onTareas}
              className={cn("relative", compacto && "h-8 px-2")}
              aria-label="Tareas"
              title="Tareas"
            >
              <ListTodo className={cn("h-4 w-4", !compacto && "sm:mr-1")} />
              {!compacto && <span className="hidden sm:inline">Tareas</span>}
              {tareasPendientes > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {tareasPendientes}
                </span>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNuevo(true)}
              className={cn(compacto && "h-8 px-2")}
              aria-label="Nueva conversación"
              title="Nueva conversación"
            >
              <Plus className={cn("h-4 w-4", !compacto && "mr-1")} />
              {!compacto && "Nuevo"}
            </Button>
            {acciones}
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={buscarRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar conversación"
            aria-label="Buscar conversación"
            className={cn("pl-9", compacto && "h-9")}
          />
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", !compacto && "pb-mobile-nav md:pb-0")}>
        {lista.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Todavía no hay conversaciones. Los grupos de cada cliente se crean solos cuando el admin asigna el equipo.
          </p>
        )}
        {lista.map((c) => {
          const unread = noLeido(c, uid);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onAbrir(c.id)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                activoId === c.id && "bg-accent"
              )}
            >
              <ChatIcon chat={c} profiles={profiles} uid={uid} color={clienteById(c.proyecto_id)?.color} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={cn("truncate text-sm", unread ? "font-bold" : "font-medium")}>
                    {tituloChat(c, uid, profiles, role)}
                  </p>
                  {c.ultimo && <span className="shrink-0 text-[11px] text-muted-foreground">{horaCorta(c.ultimo.at)}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <p className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
                    {c.ultimo
                      ? `${c.ultimo.by === uid ? "Vos: " : c.ultimo.by === PRODI_ID ? "Prodi: " : c.tipo !== "directo" ? `${(profiles.find((p) => p.id === c.ultimo!.by)?.nombre ?? c.nombres?.[c.ultimo.by] ?? "").split(" ")[0]}: ` : ""}${c.ultimo.texto}`
                      : c.tipo === "cliente"
                        ? "Grupo del cliente con el equipo"
                        : "Sin mensajes"}
                  </p>
                  {unread && <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Sin leer" />}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <CommandDialog open={nuevo} onOpenChange={setNuevo}>
        <CommandInput placeholder="¿Con quién querés hablar?" />
        <CommandList>
          <CommandEmpty>No hay nadie con ese nombre.</CommandEmpty>
          <CommandGroup heading="Mensaje privado">
            {contactos.map((p) => (
              <CommandItem
                key={p.id}
                value={`${p.nombre} ${p.email}`}
                className="gap-3"
                onSelect={async () => {
                  setNuevo(false);
                  if (!uid) return;
                  try {
                    onAbrir(await abrirDirecto(uid, p.id, { [uid]: profile?.nombre ?? "", [p.id]: p.nombre ?? "" }));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "No se pudo abrir");
                  }
                }}
              >
                <UserAvatar profile={p} size="sm" />
                <span className="flex-1 truncate">{p.nombre}</span>
                <span className="text-xs text-muted-foreground">{getRoleInfo(p.role).label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
