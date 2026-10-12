// Chat de voz de los grupos (como WhatsApp): una sala de solo audio fija por chat, que se abre en otra pestaña
// (Jitsi). Mientras estás adentro, Prodi avisa cada 30 s que seguís; con "Salir", o al cerrar Prodi, dejás de figurar.

import { useEffect, useState } from "react";
import { avisarVoz, suscribirVoz, type EnVoz } from "@/lib/db";
import { assertEditable } from "@/lib/redes/vistaComo";

const LATIDO_MS = 30_000;
const CLAVE = "prodi-chat-voz";

let miChat: string | null = leer();
let latido = 0;
const oyentes = new Set<(c: string | null) => void>();

function leer(): string | null {
  try {
    return sessionStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}
function poner(c: string | null) {
  miChat = c;
  try {
    if (c) sessionStorage.setItem(CLAVE, c);
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* nada */
  }
  window.clearInterval(latido);
  if (c) latido = window.setInterval(() => void avisarVoz(c, "latido").catch(() => undefined), LATIDO_MS);
  oyentes.forEach((f) => f(c));
}
// Si se recargó la página estando adentro, sigue figurando.
if (miChat && typeof window !== "undefined") poner(miChat);

/** Link de la sala de solo audio, con el nombre de la persona y sin la pantalla previa. */
function linkSala(base: string, sala: string, nombre: string) {
  const conf = [
    "config.startAudioOnly=true",
    "config.startWithVideoMuted=true",
    "config.prejoinConfig.enabled=false",
    `userInfo.displayName=${encodeURIComponent(JSON.stringify(nombre))}`,
  ].join("&");
  return `${base.replace(/\/$/, "")}/${sala}#${conf}`;
}

/** Entra al chat de voz de un chat. Se llama en el toque: abre la pestaña al instante (si no, el navegador la bloquea). */
export async function entrarAlChatDeVoz(chatId: string, nombre: string, jitsiBase = "https://meet.jit.si") {
  assertEditable();
  const pestaña = window.open("about:blank", "_blank");
  if (pestaña) pestaña.opener = null;
  try {
    if (miChat && miChat !== chatId) await avisarVoz(miChat, "salir").catch(() => undefined);
    const { sala } = await avisarVoz(chatId, "entrar");
    if (!sala) throw new Error("No se pudo abrir el chat de voz");
    const link = linkSala(jitsiBase, sala, nombre);
    if (pestaña) pestaña.location.href = link;
    else window.location.href = link;
    poner(chatId);
  } catch (err) {
    pestaña?.close();
    throw err;
  }
}

/** Deja de figurar en el chat de voz (la pestaña de la llamada se cierra a mano). */
export async function salirDelChatDeVoz() {
  const c = miChat;
  poner(null);
  if (c) await avisarVoz(c, "salir").catch(() => undefined);
}

/** Quién está en el chat de voz de cada chat, y en cuál estoy yo. */
export function useChatVoz(): { enVoz: EnVoz[]; miChat: string | null } {
  const [lista, setLista] = useState<EnVoz[]>([]);
  const [mio, setMio] = useState<string | null>(miChat);
  useEffect(() => suscribirVoz(setLista), []);
  useEffect(() => {
    oyentes.add(setMio);
    return () => {
      oyentes.delete(setMio);
    };
  }, []);
  return { enVoz: lista, miChat: mio };
}
