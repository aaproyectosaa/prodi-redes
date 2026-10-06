import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useInAppNotifications } from "@/hooks/use-in-app-notifications";
import { cn } from "@/lib/utils";
import { formatearFecha } from "@/lib/fecha";

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

  return (
    <div className="container mx-auto max-w-2xl px-3 sm:px-4 py-4 sm:py-6 pb-mobile-nav md:pb-8 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">Notificaciones</h1>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {unreadCount} nueva{unreadCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Avisos de tu rol: revisiones, aprobaciones, asignaciones y pedidos.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 shrink-0">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void markAllRead()}
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Marcar todas
            </Button>
          )}
          {notifications.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              disabled={deletingAll}
              onClick={() => void handleDeleteAll()}
            >
              {deletingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Eliminar todas
            </Button>
          )}
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando…
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <Bell className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">No hay notificaciones</p>
          <p className="text-xs text-muted-foreground mt-1">
            Cuando haya avisos para vos, van a aparecer acá.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {notifications.map((n) => (
            <li key={n.id}>
              <div
                className={cn(
                  "flex items-stretch gap-0 rounded-lg border transition-colors",
                  n.read
                    ? "bg-card border-border"
                    : "bg-primary/5 border-primary/25"
                )}
              >
                <button
                  type="button"
                  onClick={() => void handleOpen(n.id, n.link, n.read)}
                  className={cn(
                    "min-w-0 flex-1 text-left px-3.5 py-3 rounded-l-lg transition-colors",
                    n.read ? "hover:bg-secondary/40" : "hover:bg-primary/10"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    {!n.read && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                    )}
                    <div className={cn("min-w-0 flex-1", n.read && "pl-4")}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{n.title}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {typeLabel(n.type)}
                        </span>
                        <span className="text-[11px] text-muted-foreground ml-auto">
                          {formatRelative(n.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                    </div>
                  </div>
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
                  className="shrink-0 px-3 flex items-center justify-center rounded-r-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                >
                  {deletingId === n.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Notificaciones;
