// POST /api/drive/start-auth
// Auth: Firebase ID token in Authorization header.
// Returns { authUrl } that the client opens in a popup.
// The signed state encodes the user's uid so the callback can attribute the
// new connection to them.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError } from "../auth";
import { requireCaller } from "../http";
import { buildAuthUrl, getRedirectUri } from "../google";
import { signState } from "../state";

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
    const user = await requireCaller(req, ["admin"]);
    const state = signState(user.uid);
    const redirectUri = getRedirectUri(req);
    const authUrl = buildAuthUrl({ state, redirectUri });
    res.status(200).json({ authUrl });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Internal error";
    res.status(status).json({ error: msg });
  }
}
