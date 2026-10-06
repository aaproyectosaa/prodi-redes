import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
  writeBatch,
} from "@/lib/db";
import { auth, db } from "@/integrations/firebase/client";
import { enModoVista } from "@/lib/redes/vistaComo";

/** Avisos in-app. Los escribe el servidor (/api/avisos) con type = "prodi". */
export const IN_APP_NOTIFICATIONS_COLLECTION = "in_app_notifications";
export const IN_APP_TYPE = "prodi";

export interface InAppNotificationDoc {
  id: string;
  type: string;
  recipient_user_id: string;
  title: string;
  body: string;
  link: string;
  task_id: string | null;
  project_id: string | null;
  read: boolean;
  created_at: string;
  available_at: string;
  dedupe_key: string;
}

function isPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? "";
  return code === "permission-denied" || /permission/i.test(String(err));
}

export async function markInAppNotificationRead(id: string): Promise<void> {
  if (enModoVista()) return;
  await updateDoc(doc(db, IN_APP_NOTIFICATIONS_COLLECTION, id), {
    read: true,
    read_at: new Date().toISOString(),
  });
}

export async function markAllInAppNotificationsRead(userId: string): Promise<void> {
  if (enModoVista()) return;
  const snap = await getDocs(
    query(
      collection(db, IN_APP_NOTIFICATIONS_COLLECTION),
      where("recipient_user_id", "==", userId),
      where("read", "==", false),
      limit(200)
    )
  );
  if (snap.empty) return;
  const batch = writeBatch(db);
  const now = new Date().toISOString();
  snap.docs.forEach((d) => batch.update(d.ref, { read: true, read_at: now }));
  await batch.commit();
}

async function deleteViaApi(mode: "one" | "all", payload: { id?: string; userId?: string }) {
  const user = auth.currentUser;
  if (!user) throw new Error("No hay sesión");
  const idToken = await user.getIdToken();
  const res = await fetch("/api/in-app-notifications/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ mode, ...payload }),
  });
  if (!res.ok) throw new Error(`No se pudo borrar (${res.status})`);
}

export async function deleteInAppNotification(id: string): Promise<void> {
  if (enModoVista()) return;
  try {
    await deleteDoc(doc(db, IN_APP_NOTIFICATIONS_COLLECTION, id));
  } catch (err) {
    if (!isPermissionDenied(err)) throw err;
    await deleteViaApi("one", { id });
  }
}

export async function deleteAllInAppNotifications(userId: string): Promise<void> {
  if (enModoVista()) return;
  try {
    const snap = await getDocs(
      query(
        collection(db, IN_APP_NOTIFICATIONS_COLLECTION),
        where("recipient_user_id", "==", userId),
        limit(400)
      )
    );
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 200) {
      const batch = writeBatch(db);
      docs.slice(i, i + 200).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (err) {
    if (!isPermissionDenied(err)) throw err;
    await deleteViaApi("all", { userId });
  }
}
