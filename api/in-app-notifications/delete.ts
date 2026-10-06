// POST /api/in-app-notifications/delete
// Auth: Firebase ID token. Borra una o todas las notis del usuario.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, requireUser } from "../_lib/auth";
import { adminDb } from "../_lib/db";

export const config = {
  maxDuration: 30,
};

const COLLECTION = "in_app_notifications";

type Body = {
  mode?: "one" | "all";
  id?: string;
  userId?: string;
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authed = await requireUser(req);
    const data = (req.body ?? {}) as Body;
    const mode = data.mode === "all" ? "all" : "one";
    const db = adminDb();

    if (mode === "one") {
      const id = typeof data.id === "string" ? data.id.trim() : "";
      if (!id) throw new HttpError(400, "Missing id");

      const ref = db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(200).json({ ok: true, deleted: 0 });
        return;
      }
      if (snap.data()?.recipient_user_id !== authed.uid) {
        throw new HttpError(403, "Not your notification");
      }
      await ref.delete();
      res.status(200).json({ ok: true, deleted: 1 });
      return;
    }

    // mode === "all": solo las del usuario autenticado
    const targetUserId =
      typeof data.userId === "string" && data.userId.trim()
        ? data.userId.trim()
        : authed.uid;
    if (targetUserId !== authed.uid) {
      throw new HttpError(403, "Can only delete your own notifications");
    }

    const snap = await db
      .collection(COLLECTION)
      .where("recipient_user_id", "==", targetUserId)
      .limit(200)
      .get();

    let deleted = 0;
    const batchSize = 200;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      docs.slice(i, i + batchSize).forEach((d) => {
        batch.delete(d.ref);
        deleted += 1;
      });
      await batch.commit();
    }

    res.status(200).json({ ok: true, deleted });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Internal error";
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
    }
  }
}
