// HMAC-signed state tokens for the OAuth flow.
// Carries { uid, ts, nonce } so the callback can identify the user that
// initiated the flow without an extra DB roundtrip. Valid for 10 minutes.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  uid: string;
  ts: number;
  nonce: string;
}

function getSecret(): string {
  const secret =
    process.env.OAUTH_STATE_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("OAUTH_STATE_SECRET (or TOKEN_ENCRYPTION_KEY) missing");
  }
  return secret;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
  const padded = input + "=".repeat(pad);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signState(uid: string): string {
  const payload: StatePayload = {
    uid,
    ts: Date.now(),
    nonce: randomBytes(8).toString("hex"),
  };
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const sig = base64url(
    createHmac("sha256", getSecret()).update(body).digest()
  );
  return `${body}.${sig}`;
}

export function verifyState(state: string): StatePayload {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Invalid state format");

  const expected = base64url(
    createHmac("sha256", getSecret()).update(body).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid state signature");
  }

  const payload = JSON.parse(fromBase64url(body).toString("utf-8")) as StatePayload;
  if (Date.now() - payload.ts > STATE_TTL_MS) {
    throw new Error("State expired");
  }
  return payload;
}
