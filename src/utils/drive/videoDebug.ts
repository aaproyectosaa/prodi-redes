/** Logs de reproducción de video. En prod: localStorage.setItem("DEBUG_VIDEO", "1") */

const PREFIX = "[DriveVideo]";

export function isVideoDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem("DEBUG_VIDEO") === "1";
  } catch {
    return false;
  }
}

export function logVideo(step: string, data?: Record<string, unknown>): void {
  if (!isVideoDebugEnabled()) return;
  if (data) {
    console.log(PREFIX, step, data);
  } else {
    console.log(PREFIX, step);
  }
}

export function mediaErrorLabel(code: number | undefined): string {
  switch (code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "MEDIA_ERR_ABORTED (1)";
    case MediaError.MEDIA_ERR_NETWORK:
      return "MEDIA_ERR_NETWORK (2)";
    case MediaError.MEDIA_ERR_DECODE:
      return "MEDIA_ERR_DECODE (3)";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "MEDIA_ERR_SRC_NOT_SUPPORTED (4)";
    default:
      return code != null ? `desconocido (${code})` : "sin código";
  }
}

export async function probeDriveMediaUrl(url: string): Promise<{
  ok: boolean;
  status: number;
  contentType: string | null;
  acceptRanges: string | null;
  contentRange: string | null;
  error?: string;
}> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-1023" },
    });
    const ok = res.ok || res.status === 206;
    if (!ok) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        status: res.status,
        contentType: res.headers.get("content-type"),
        acceptRanges: res.headers.get("accept-ranges"),
        contentRange: res.headers.get("content-range"),
        error: body || res.statusText,
      };
    }
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get("content-type"),
      acceptRanges: res.headers.get("accept-ranges"),
      contentRange: res.headers.get("content-range"),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: null,
      acceptRanges: null,
      contentRange: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
