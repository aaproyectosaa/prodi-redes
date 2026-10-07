// Fotos de perfil.
// La foto (JPEG cuadrado chico, en data URL) se guarda en el perfil y una copia en avatares/{uid}:
// los clientes no pueden leer los perfiles del equipo, pero sí la foto de quienes comparten un chat con ellos.

import { useSyncExternalStore } from "react";
import { collection, doc, getDocs, writeBatch } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { Profile } from "@/integrations/firebase/types";
import { abrirImagen, recorteCuadrado } from "@/lib/imagen";
import { enModoVista } from "@/lib/redes/vistaComo";

export const AVATARES = "avatares";
/** Tamaño de la foto guardada (px) y tope del data URL. */
export const AVATAR_LADO = 256;
export const AVATAR_MAX = 60_000;

// ---- Fotos que llegan por avatares/{uid} (las usa UserAvatar si el perfil no trae foto) ----
let mapa: Record<string, string> = {};
const oyentes = new Set<() => void>();

export function setAvatares(m: Record<string, string>) {
  mapa = m;
  oyentes.forEach((f) => f());
}

export function useAvatarDe(id: string | undefined): string | undefined {
  const m = useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => mapa
  );
  return id ? m[id] : undefined;
}

/** Guarda (o saca, con "") la foto de perfil del usuario. */
export async function guardarFotoPerfil(uid: string, img: string) {
  const lote = writeBatch(db);
  lote.set(doc(db, "profiles", uid), { profileImage: img }, { merge: true });
  if (img) lote.set(doc(db, AVATARES, uid), { img, updated_at: new Date().toISOString() });
  else lote.delete(doc(db, AVATARES, uid));
  await lote.commit();
}

async function achicar(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const img = await abrirImagen(new File([blob], "foto", { type: blob.type }));
  return recorteCuadrado(img, undefined, AVATAR_LADO, AVATAR_MAX);
}

/**
 * Lo corre el super admin al abrir la app (una vez por sesión): copia a avatares/ las fotos que ya
 * estaban en los perfiles y achica las viejas que eran pesadas (antes se guardaban hasta 700 KB).
 */
let sincronizado = false;
export async function sincronizarAvatares(profiles: Profile[]) {
  if (sincronizado || enModoVista() || !profiles.length) return;
  sincronizado = true;
  try {
    const snap = await getDocs(collection(db, AVATARES));
    const actuales = new Map<string, string>(snap.docs.map((d) => [d.id, String(d.data()?.img ?? "")]));
    const ops: ((l: ReturnType<typeof writeBatch>) => void)[] = [];
    for (const p of profiles) {
      let img = p.profileImage || "";
      if (img && (img.length > AVATAR_MAX * 1.5 || !img.startsWith("data:image/jpeg"))) {
        try {
          const chica = await achicar(img);
          ops.push((l) => l.update(doc(db, "profiles", p.id), { profileImage: chica }));
          img = chica;
        } catch {
          // No se pudo abrir (p. ej. un HEIC viejo en Chrome): se deja como está y no se copia.
          continue;
        }
      }
      if (img && actuales.get(p.id) !== img) {
        const copia = img;
        ops.push((l) => l.set(doc(db, AVATARES, p.id), { img: copia, updated_at: new Date().toISOString() }));
      } else if (!img && actuales.has(p.id)) {
        ops.push((l) => l.delete(doc(db, AVATARES, p.id)));
      }
    }
    for (let i = 0; i < ops.length; i += 20) {
      const l = writeBatch(db);
      ops.slice(i, i + 20).forEach((f) => f(l));
      await l.commit();
    }
  } catch (err) {
    console.warn("[avatares] no se pudieron sincronizar", err);
  }
}
