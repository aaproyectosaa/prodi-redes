// POST /api/drive/disconnect
// Auth: Firebase ID token in Authorization header.
// Only the owner can disconnect. Revokes the refresh token at Google and
// clears stored credentials in Firestore.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError } from "../auth";
import { requireCaller } from "../http";
import { adminDb } from "../db";
import { decrypt } from "../crypto";
import { revokeToken } from "../google";
import { FieldValue } from "../db";
import { olvidarTokenDrive } from "../drive-connection";

const COLLECTION = "app_settings";
const DOC_ID = "drive_connection";

export const config = {
  maxDuration: 30,
};

interface StoredConnection {
  owner_uid?: string;
  refresh_token_enc?: {
    ciphertext: string;
    iv: string;
    authTag: string;
    algorithm: "aes-256-gcm";
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const user = await requireCaller(req, ["admin"]);
    const db = adminDb();
    const ref = db.collection(COLLECTION).doc(DOC_ID);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(200).json({ ok: true, already: true });
      return;
    }
    const data = snap.data() as StoredConnection;

    if (data.owner_uid && data.owner_uid !== user.uid) {
      res.status(403).json({ error: "Only the owner can disconnect" });
      return;
    }

    if (data.refresh_token_enc) {
      try {
        const refreshToken = decrypt(data.refresh_token_enc);
        await revokeToken(refreshToken);
      } catch {
        // Best effort.
      }
    }

    olvidarTokenDrive();
    await ref.update({
      status: "disconnected",
      disconnected_at: new Date().toISOString(),
      refresh_token_enc: FieldValue.delete(),
      last_error: null,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Internal error";
    res.status(status).json({ error: msg });
  }
}
