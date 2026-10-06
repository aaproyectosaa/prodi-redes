// POST /api/drive/access-token
// Auth: Firebase ID token in Authorization header.
// Returns a fresh access_token by using the stored refresh_token.
// Anyone authenticated in the app can call this, since uploads come from
// any team member but always use the owner's refresh token.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError } from "../auth";
import { requireCaller } from "../http";
import {
  DriveConnectionError,
  getAppDriveAccessToken,
} from "../drive-connection";

// Hobby plan supports up to 60s; default is 10s which causes timeouts on
// cold start + Firebase token verify + Google refresh roundtrip.
export const config = {
  maxDuration: 30,
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
    // Solo el equipo sube archivos (el token da acceso a todo lo que la app creó en Drive).
    await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno"]);
    const { accessToken, email, expiresIn } = await getAppDriveAccessToken();

    res.status(200).json({
      access_token: accessToken,
      expires_in: expiresIn,
      email,
    });
  } catch (err) {
    if (err instanceof DriveConnectionError) {
      if (!res.headersSent) {
        res.status(err.status).json({ error: err.code });
      }
      return;
    }
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Internal error";
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
    }
  }
}
