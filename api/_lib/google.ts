// Helpers for Google OAuth 2.0 token exchange and Drive folder bootstrap.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface GoogleTokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
  scope?: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  email: string;
  sub: string;
  name?: string;
  picture?: string;
}

export class GoogleAuthError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getClientCredentials(): { id: string; secret: string } {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new GoogleAuthError(
      "GOOGLE_OAUTH_CLIENT_ID/SECRET missing in env",
      500
    );
  }
  return { id, secret };
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<GoogleTokens> {
  const { id, secret } = getClientCredentials();
  const body = new URLSearchParams({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as
    | (GoogleTokens & { error?: undefined })
    | { error: string; error_description?: string };
  if (!res.ok || "error" in data) {
    const err = "error" in data ? data : null;
    throw new GoogleAuthError(
      err?.error_description ?? err?.error ?? "Token exchange failed",
      res.status,
      err?.error
    );
  }
  return data;
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<GoogleTokens> {
  const { id, secret } = getClientCredentials();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: id,
    client_secret: secret,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as
    | GoogleTokens
    | { error: string; error_description?: string };
  if (!res.ok || "error" in data) {
    const err = "error" in data ? data : null;
    throw new GoogleAuthError(
      err?.error_description ?? err?.error ?? "Refresh failed",
      res.status,
      err?.error
    );
  }
  return data;
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  // Best-effort: ignore failures (token may already be invalid).
}

export async function fetchUserInfo(
  accessToken: string
): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new GoogleAuthError(`userinfo failed (${res.status})`, res.status);
  }
  const data = (await res.json()) as {
    email: string;
    sub: string;
    name?: string;
    picture?: string;
  };
  return data;
}

/**
 * Ensures a top-level folder named `name` exists in My Drive.
 * Returns its id.
 */
export async function ensureRootFolder(
  name: string,
  accessToken: string
): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const q = `name = '${safe}' and 'root' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const searchUrl = `${DRIVE_API}/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name)&pageSize=1`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!searchRes.ok) {
    throw new GoogleAuthError(
      `Drive search failed (${searchRes.status})`,
      searchRes.status
    );
  }
  const found = (await searchRes.json()) as {
    files?: Array<{ id: string; name: string }>;
  };
  if (found.files?.[0]?.id) return found.files[0].id;

  const createRes = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: ["root"],
    }),
  });
  if (!createRes.ok) {
    throw new GoogleAuthError(
      `Drive create folder failed (${createRes.status})`,
      createRes.status
    );
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/**
 * Builds the Google OAuth consent URL for the code flow.
 */
export function buildAuthUrl(params: {
  state: string;
  redirectUri: string;
}): string {
  const { id } = getClientCredentials();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    "https://www.googleapis.com/auth/drive.file openid email profile"
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export function getRedirectUri(req: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host) as
    | string
    | undefined;
  const proto =
    ((req.headers["x-forwarded-proto"] as string) ?? "https").split(",")[0] ??
    "https";
  if (!host) throw new Error("Cannot determine host for redirect URI");
  return `${proto}://${host}/api/drive/oauth-callback`;
}
