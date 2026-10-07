import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
} from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import {
  IN_APP_NOTIFICATIONS_COLLECTION,
  IN_APP_TYPE,
  type InAppNotificationDoc,
  markAllInAppNotificationsRead,
  markInAppNotificationRead,
  deleteInAppNotification,
  deleteAllInAppNotifications,
} from "@/lib/inAppNotifications";
import { sonarProdi } from "@/lib/sonido";
import { enModoVista } from "@/lib/redes/vistaComo";

/**
 * Avisos ya vistos (id + fecha), compartido entre todas las instancias del hook (barra lateral, menú,
 * página de avisos): así el sonido sale una sola vez por aviso nuevo y nunca por los que ya estaban.
 */
const vistos = new Set<string>();
const usuariosCargados = new Set<string>();

/** Avisos del sistema anterior (tareas, PM, CM…): se limpian solos. */
function isObsoleteNotification(data: { type?: string }): boolean {
  return (data.type ?? "") !== IN_APP_TYPE;
}

function isAvailable(n: InAppNotificationDoc, nowIso: string): boolean {
  return !n.available_at || n.available_at <= nowIso;
}

export function useInAppNotifications(userId: string | undefined) {
  const [items, setItems] = useState<InAppNotificationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, IN_APP_NOTIFICATIONS_COLLECTION),
      where("recipient_user_id", "==", userId)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: InAppNotificationDoc[] = [];
        const obsoleteIds: string[] = [];

        for (const d of snap.docs) {
          const data = d.data();
          if (isObsoleteNotification(data)) {
            obsoleteIds.push(d.id);
            continue;
          }
          list.push({
            id: d.id,
            type: data.type,
            recipient_user_id: data.recipient_user_id,
            title: data.title ?? "",
            body: data.body ?? "",
            link: data.link ?? "/",
            task_id: data.task_id ?? null,
            project_id: data.project_id ?? null,
            read: data.read === true,
            created_at: data.created_at ?? "",
            available_at: data.available_at ?? data.created_at ?? "",
            dedupe_key: data.dedupe_key ?? d.id,
          });
        }

        list.sort((a, b) =>
          (b.created_at || "").localeCompare(a.created_at || "")
        );
        // Sonido: solo por avisos sin leer que llegaron recién (nunca en la primera carga).
        const primera = !usuariosCargados.has(userId);
        usuariosCargados.add(userId);
        const hace2min = new Date(Date.now() - 2 * 60_000).toISOString();
        let nuevo = false;
        for (const n of list) {
          const k = `${n.id}:${n.available_at}`;
          if (vistos.has(k)) continue;
          vistos.add(k);
          if (!primera && !n.read && (n.available_at || "") >= hace2min) nuevo = true;
        }
        if (nuevo && !enModoVista()) sonarProdi();

        setItems(list);
        setLoading(false);

        // Limpieza de avisos viejos de reuniones (ya no existen en la app)
        if (obsoleteIds.length > 0) {
          void Promise.all(
            obsoleteIds.map((id) =>
              deleteDoc(doc(db, IN_APP_NOTIFICATIONS_COLLECTION, id)).catch(
                (err) =>
                  console.error("No se pudo borrar noti obsoleta:", id, err)
              )
            )
          );
        }
      },
      (err) => {
        console.error("Error cargando notificaciones in-app:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userId]);

  // Re-evaluar recordatorios diferidos cada minuto
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const nowIso = useMemo(() => new Date(nowTick).toISOString(), [nowTick]);

  const visible = useMemo(
    () => items.filter((n) => isAvailable(n, nowIso)),
    [items, nowIso]
  );

  const unreadCount = useMemo(
    () => visible.filter((n) => !n.read).length,
    [visible]
  );

  const markRead = async (id: string) => {
    try {
      await markInAppNotificationRead(id);
    } catch (err) {
      console.error("Error marcando notificación leída:", err);
    }
  };

  const markAllRead = async () => {
    if (!userId) return;
    try {
      await markAllInAppNotificationsRead(userId);
    } catch (err) {
      console.error("Error marcando todas leídas:", err);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteInAppNotification(id);
    } catch (err) {
      console.error("Error eliminando notificación:", err);
      throw err;
    }
  };

  const removeAll = async () => {
    if (!userId) return;
    try {
      await deleteAllInAppNotifications(userId);
    } catch (err) {
      console.error("Error eliminando todas las notificaciones:", err);
      throw err;
    }
  };

  return {
    notifications: visible,
    unreadCount,
    loading,
    markRead,
    markAllRead,
    remove,
    removeAll,
  };
}
