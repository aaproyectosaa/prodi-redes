import { useEffect, useState, useCallback } from "react";
import { db, auth } from "@/integrations/firebase/client";
import { doc, onSnapshot } from "@/lib/db";
import { onAuthStateChanged, type User } from "@/lib/auth";
import {
  startOAuthFlow,
  disconnectDrive,
  DriveAuthError,
} from "@/utils/drive/auth";
import { ensureAccessToken, clearToken } from "@/utils/drive/tokenStore";
import { clearFolderCache } from "@/utils/drive/folderCache";
import type {
  DriveConnection,
  DriveConnectionStatus,
} from "@/utils/drive/types";

const APP_SETTINGS_DOC = ["app_settings", "drive_connection"] as const;

export interface UseDriveConnection {
  connection: DriveConnection | null;
  status: DriveConnectionStatus;
  loading: boolean;
  error: string | null;
  isOwner: boolean;
  /** Lanza el flujo OAuth (popup) y persiste la conexión via backend */
  connect: () => Promise<void>;
  /** Revoca acceso y marca como desconectado */
  disconnect: () => Promise<void>;
  /** Reintenta tras 'revoked' (lanza UI de consent) */
  reconnect: () => Promise<void>;
  /** Devuelve un access token válido, lanza error si no se puede */
  ensureToken: () => Promise<string>;
}

/**
 * Hook que expone el estado de la conexión global a Google Drive.
 * Es UNA conexión para toda la app — no por proyecto.
 */
export function useDriveConnection(): UseDriveConnection {
  const [connection, setConnection] = useState<DriveConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, APP_SETTINGS_DOC[0], APP_SETTINGS_DOC[1]),
      (snap) => {
        const next = snap.exists()
          ? (snap.data() as DriveConnection)
          : null;
        setConnection((prev) => {
          // Si cambió el dueño/cuenta o se desconectó, limpiamos caches.
          if (
            prev &&
            (next?.google_sub !== prev.google_sub ||
              next?.status !== "connected")
          ) {
            clearToken();
          }
          if (
            prev &&
            next?.google_sub &&
            prev.google_sub !== next.google_sub
          ) {
            clearFolderCache();
          }
          return next;
        });
        setLoading(false);
      },
      (err) => {
        console.error("drive_connection snapshot error", err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const status: DriveConnectionStatus = loading
    ? "loading"
    : (connection?.status ?? "disconnected");

  const isOwner = !!(
    user &&
    connection &&
    connection.owner_uid === user.uid
  );

  const connect = useCallback(async () => {
    setError(null);
    try {
      if (!user) throw new Error("Necesitás estar logueado");
      await startOAuthFlow();
      // El backend ya escribió el doc; el snapshot listener lo va a recibir.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    }
  }, [user]);

  const reconnect = connect;

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await disconnectDrive();
      clearToken();
      clearFolderCache();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    }
  }, []);

  const ensureToken = useCallback(async (): Promise<string> => {
    if (!connection) throw new Error("Sin conexión a Google Drive");
    if (connection.status !== "connected") {
      throw new Error("La conexión está revocada o desconectada");
    }
    try {
      return await ensureAccessToken();
    } catch (err) {
      // Si el backend dice que el refresh token fue revocado, ya marcó el
      // doc como 'revoked' — el snapshot va a actualizar la UI sólo.
      if (err instanceof DriveAuthError && err.code === "refresh_revoked") {
        clearToken();
      }
      throw err;
    }
  }, [connection]);

  return {
    connection,
    status,
    loading,
    error,
    isOwner,
    connect,
    disconnect,
    reconnect,
    ensureToken,
  };
}
