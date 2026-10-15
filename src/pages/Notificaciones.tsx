import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff, CheckCheck, ChevronRight, Loader2, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useInAppNotifications } from "@/hooks/use-in-app-notifications";
import { cn } from "@/lib/utils";
import { fechaAR, formatearFecha, hoyAR, sumarDias } from "@/lib/fecha";
import { abrirEnDock, chatDeLink } from "@/lib/redes/chatDock";

function formatRelative(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days} d`;
  return formatearFecha(iso, {
    day: "numeric",
    month: "short",
  });
}

function typeLabel(_type: string): string {
  return "Aviso";
}

/** Título del grupo del día (en hora de AR): Hoy, Ayer o la fecha. */
function tituloDia(dia: string): string {
  if (!dia) return "Antes";
  const hoy = hoyAR();
  if (dia === hoy) return "Hoy";
  if (dia === sumarDias(hoy, -1)) return "Ayer";
  const texto = formatearFecha(dia, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(dia.slice(0, 4) !== hoy.slice(0, 4) ? { year: "numeric" as const } : {}),
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const Notificaciones = () => {
  const navigate = useNavigate();
  const { user } = useUserProfileContext();
  const {
    notifications,
    unreadCount,
    loading,
    markRead,
    markAllRead,
    remove,
    removeAll,
  } = useInAppNotifications(user?.uid);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const handleOpen = async (id: string, link: string, read: boolean) => {
    if (!read) await markRead(id);
    // Un aviso de chat se abre en el chat flotante (si está disponible), sin salir de acá.
    if (abrirEnDock(chatDeLink(link))) return;
    navigate(link || "/");
  };

  const handleDeleteOne = async (id: string) => {
    setDeletingId(id);
    try {
      await remove(id);
      toast.success("Notificación eliminada");
    } catch {
      toast.error("No se pudo eliminar la notificación");
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (notifications.length === 0) return;
    const ok = window.confirm(
      `¿Eliminar las ${notifications.length} notificación${
        notifications.length === 1 ? "" : "es"
      }?`
    );
    if (!ok) return;

    setDeletingAll(true);
    try {
      await removeAll();
      toast.success("Notificaciones eliminadas");
    } catch {
      toast.error("No se pudieron eliminar las notificaciones");
    } finally {
      setDeletingAll(false);
    }
  };

  // Agrupa por día (hora de AR) manteniendo el orden que ya trae la lista.
  const grupos: { dia: string; items: typeof notifications }[] = [];
  for (const n of notifications) {
    const dia = n.created_at ? fechaAR(n.created_at) : "";
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.items.push(n);
    else grupos.push({ dia, items: [n] });
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-5 sm:py-6 pb-mobile-nav md:pb-8 space-y-5">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight">Notificaciones</h1>
            <p className="text-sm text-muted-foreground">
              {unreadCount > 0
                ? `Tenés ${unreadCount} aviso${unreadCount === 1 ? "" : "s"} sin leer.`
                : "Revisiones, aprobaciones, asignaciones y pedidos de tu rol."}
            </p>
          </div>
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-1.5 text-[10px] font-bold text-primary-foreground shadow-md shadow-primary/25">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </span>
        </div>

        {notifications.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 rounded-full bg-primary/10 px-3.5 font-semibold text-primary hover:bg-primary/15 hover:text-primary"
                onClick={() => void markAllRead()}
              >
                <CheckCheck className="h-4 w-4" />
                Marcar todo leído
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 rounded-full bg-muted/60 px-3.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              disabled={deletingAll}
              onClick={() => void handleDeleteAll()}
            >
              {deletingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Eliminar todas
            </Button>
          </div>
        )}
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-muted/60 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando…
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl bg-muted/60 px-6 py-14 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <BellOff className="h-6 w-6" />
          </span>
          <p className="text-base font-semibold">Estás al día</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            No hay notificaciones. Cuando haya avisos para vos, van a aparecer acá.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map((g, gi) => (
            <section key={`${g.dia}-${gi}`} className="space-y-2">
              <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {tituloDia(g.dia)}
              </h2>
              <ul className="space-y-2">
                {g.items.map((n) => {
                  const esChat = Boolean(chatDeLink(n.link));
                  const Icono = esChat ? MessageCircle : Bell;
                  return (
                    <li key={n.id}>
                      <div
                        className={cn(
                          "flex items-stretch overflow-hidden rounded-2xl border transition-colors",
                          n.read
                            ? "border-border bg-card"
                            : "border-primary/25 bg-primary/5"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void handleOpen(n.id, n.link, n.read)}
                          className={cn(
                            "flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3.5 text-left transition-colors",
                            n.read ? "hover:bg-muted/60" : "hover:bg-primary/10"
                          )}
                        >
                          <span
                            className={cn(
                              "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                              n.read
                                ? "bg-muted text-muted-foreground"
                                : "bg-primary/10 text-primary"
                            )}
                          >
                            <Icono className="h-5 w-5" />
                            {!n.read && (
                              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-card bg-primary" />
                            )}
                          </span>
                          <span className="block min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-[15px] leading-snug",
                                  n.read ? "font-medium" : "font-bold"
                                )}
                              >
                                {n.title}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 text-[11px]",
                                  n.read ? "text-muted-foreground" : "font-semibold text-primary"
                                )}
                              >
                                {formatRelative(n.created_at)}
                              </span>
                            </span>
                            {n.body && (
                              <span className="mt-0.5 line-clamp-2 block text-sm leading-snug text-muted-foreground">
                                {n.body}
                              </span>
                            )}
                            <span className="mt-1.5 flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                              {esChat ? "Chat" : typeLabel(n.type)}
                              <ChevronRight className="h-3 w-3" />
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          title="Eliminar"
                          aria-label="Eliminar notificación"
                          disabled={deletingId === n.id || deletingAll}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteOne(n.id);
                          }}
                          className="flex w-11 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        >
                          {deletingId === n.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default Notificaciones;
