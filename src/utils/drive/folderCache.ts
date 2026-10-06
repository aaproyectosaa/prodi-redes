// Cache global de folder IDs en localStorage para evitar re-resolver toda
// la jerarquía de carpetas en cada upload.

const KEY = "drive_folder_cache_v1";

export function loadFolderCache(): Map<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export function saveFolderCache(cache: Map<string, string>) {
  try {
    const obj: Record<string, string> = {};
    cache.forEach((v, k) => {
      obj[k] = v;
    });
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    // localStorage lleno o no disponible — ignorar
  }
}

export function clearFolderCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
