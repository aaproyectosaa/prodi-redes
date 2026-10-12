// Chat de voz de los grupos (como WhatsApp), adentro de Prodi.
// Los celulares se conectan directo entre sí (WebRTC): el audio no pasa por Prodi, que solo los presenta
// (señales "oferta" / "respuesta"). El que entra llama a los que ya estaban; cada uno avisa cada 30 s que sigue.

import { useEffect, useState, useSyncExternalStore } from "react";
import { avisarVoz, enviarSenal, leerSenales, suscribirVoz, type EnVoz, type Senal } from "@/lib/db";
import { assertEditable } from "@/lib/redes/vistaComo";

const LATIDO_MS = 30_000;

/** Servidores para encontrarse a través de internet. Si hay un TURN configurado (redes difíciles), también. */
function servidoresIce(): RTCIceServer[] {
  const s: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const turn = (import.meta.env.VITE_TURN_URLS as string | undefined)?.trim();
  if (turn) {
    s.push({
      urls: turn.split(",").map((u) => u.trim()),
      username: import.meta.env.VITE_TURN_USER as string | undefined,
      credential: import.meta.env.VITE_TURN_PASS as string | undefined,
    });
  }
  return s;
}

type EstadoPar = "conectando" | "conectado" | "sin-conexion";
interface Par {
  uid: string;
  nombre: string;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  estado: EstadoPar;
  hablando: boolean;
  desde: number;
  medir?: () => void;
}

export interface Llamada {
  chatId: string;
  chatNombre: string;
  muteado: boolean;
  yoHablando: boolean;
  personas: { uid: string; nombre: string; estado: EstadoPar; hablando: boolean }[];
}

// ---- Estado de la llamada (uno solo a la vez) ----
let actual: {
  chatId: string;
  chatNombre: string;
  mic: MediaStream;
  muteado: boolean;
  yoHablando: boolean;
  pares: Map<string, Par>;
  latido: number;
  sondeo: number;
  ctx: AudioContext | null;
  medirMio?: () => void;
  finPresencia?: () => void;
} | null = null;
let foto: Llamada | null = null;
const oyentes = new Set<() => void>();

function avisar() {
  foto = actual
    ? {
        chatId: actual.chatId,
        chatNombre: actual.chatNombre,
        muteado: actual.muteado,
        yoHablando: actual.yoHablando,
        personas: [...actual.pares.values()].map((p) => ({ uid: p.uid, nombre: p.nombre, estado: p.estado, hablando: p.hablando })),
      }
    : null;
  oyentes.forEach((f) => f());
}

/** Mide el volumen de un audio para marcar quién está hablando. */
function medidor(ctx: AudioContext | null, stream: MediaStream, alCambiar: (hablando: boolean) => void): (() => void) | undefined {
  if (!ctx) return undefined;
  try {
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    let antes = false;
    const t = window.setInterval(() => {
      an.getByteFrequencyData(buf);
      const prom = buf.reduce((a, b) => a + b, 0) / buf.length;
      const ahora = prom > 18;
      if (ahora !== antes) {
        antes = ahora;
        alCambiar(ahora);
      }
    }, 250);
    return () => window.clearInterval(t);
  } catch {
    return undefined;
  }
}

/** Espera a juntar los caminos posibles (máx. 3 s) para mandar la presentación completa de una vez. */
function esperarIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((ok) => {
    const fin = () => {
      pc.removeEventListener("icegatheringstatechange", alCambiar);
      ok();
    };
    const alCambiar = () => pc.iceGatheringState === "complete" && fin();
    pc.addEventListener("icegatheringstatechange", alCambiar);
    window.setTimeout(fin, 3_000);
  });
}

function crearPar(uid: string, nombre: string): Par {
  const a = actual!;
  a.pares.get(uid)?.pc.close();
  const pc = new RTCPeerConnection({ iceServers: servidoresIce() });
  a.mic.getAudioTracks().forEach((t) => pc.addTrack(t, a.mic));
  const audio = new Audio();
  audio.autoplay = true;
  audio.setAttribute("playsinline", "");
  const par: Par = { uid, nombre, pc, audio, estado: "conectando", hablando: false, desde: Date.now() };
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    par.medir?.();
    par.medir = medidor(a.ctx, stream, (h) => {
      par.hablando = h;
      avisar();
    });
  };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    par.estado = s === "connected" ? "conectado" : s === "failed" || s === "disconnected" ? "sin-conexion" : "conectando";
    avisar();
  };
  a.pares.set(uid, par);
  avisar();
  return par;
}

function cerrarPar(uid: string) {
  const p = actual?.pares.get(uid);
  if (!p) return;
  p.medir?.();
  p.pc.close();
  p.audio.srcObject = null;
  actual!.pares.delete(uid);
  avisar();
}

async function llamarA(uid: string, nombre: string) {
  const a = actual;
  if (!a) return;
  const par = crearPar(uid, nombre);
  const oferta = await par.pc.createOffer();
  await par.pc.setLocalDescription(oferta);
  await esperarIce(par.pc);
  if (actual !== a) return;
  await enviarSenal(a.chatId, uid, "oferta", { type: "offer", sdp: par.pc.localDescription?.sdp }).catch(() => undefined);
}

async function atender(s: Senal) {
  const a = actual;
  if (!a || s.chat_id !== a.chatId) return;
  if (s.tipo === "chau") return cerrarPar(s.de);
  if (s.tipo === "oferta" && s.data.sdp) {
    const par = crearPar(s.de, s.de_nombre || "Alguien");
    await par.pc.setRemoteDescription({ type: "offer", sdp: s.data.sdp });
    const resp = await par.pc.createAnswer();
    await par.pc.setLocalDescription(resp);
    await esperarIce(par.pc);
    if (actual !== a) return;
    await enviarSenal(a.chatId, s.de, "respuesta", { type: "answer", sdp: par.pc.localDescription?.sdp }).catch(() => undefined);
    return;
  }
  if (s.tipo === "respuesta" && s.data.sdp) {
    const par = a.pares.get(s.de);
    if (par && par.pc.signalingState === "have-local-offer") await par.pc.setRemoteDescription({ type: "answer", sdp: s.data.sdp }).catch(() => undefined);
  }
}

/** Pregunta seguido por señales nuevas (cada 1 s al principio, después cada 2 s). */
function sondearSenales(inicio: number) {
  const a = actual;
  if (!a) return;
  a.sondeo = window.setTimeout(async () => {
    try {
      for (const s of await leerSenales()) await atender(s).catch(() => undefined);
    } catch {
      /* se reintenta */
    }
    if (actual === a) sondearSenales(inicio);
  }, Date.now() - inicio < 30_000 ? 1_000 : 2_000);
}

/** Entra al chat de voz del chat (se llama desde el toque: el navegador pide el micrófono). */
export async function entrarAlChatDeVoz(chatId: string, chatNombre: string) {
  assertEditable();
  if (actual?.chatId === chatId) return;
  if (actual) await salirDelChatDeVoz();
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
    throw new Error("Este navegador no permite llamadas de voz");
  }
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    throw new Error("Permití el micrófono para entrar al chat de voz");
  }
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null;
  }
  actual = { chatId, chatNombre, mic, muteado: false, yoHablando: false, pares: new Map(), latido: 0, sondeo: 0, ctx };
  const a = actual;
  a.medirMio = medidor(ctx, mic, (h) => {
    a.yoHablando = h && !a.muteado;
    avisar();
  });
  avisar();
  try {
    const r = await avisarVoz(chatId, "entrar");
    a.latido = window.setInterval(() => void avisarVoz(chatId, "latido").catch(() => undefined), LATIDO_MS);
    sondearSenales(Date.now());
    // Si alguien dejó de figurar (cerró Prodi sin colgar), se corta con esa persona.
    a.finPresencia = suscribirVoz((lista) => {
      if (actual !== a) return;
      const siguen = new Set(lista.filter((v) => v.chat_id === a.chatId).map((v) => v.uid));
      for (const p of a.pares.values()) if (!siguen.has(p.uid) && Date.now() - p.desde > 20_000) cerrarPar(p.uid);
    });
    for (const p of r.adentro ?? []) void llamarA(p.uid, p.nombre).catch(() => undefined);
  } catch (err) {
    await salirDelChatDeVoz();
    throw err;
  }
}

/** Cuelga: avisa a los demás, suelta el micrófono y deja de figurar. */
export async function salirDelChatDeVoz() {
  const a = actual;
  if (!a) return;
  actual = null;
  window.clearInterval(a.latido);
  window.clearTimeout(a.sondeo);
  a.finPresencia?.();
  a.medirMio?.();
  for (const p of a.pares.values()) {
    void enviarSenal(a.chatId, p.uid, "chau").catch(() => undefined);
    p.medir?.();
    p.pc.close();
    p.audio.srcObject = null;
  }
  a.mic.getTracks().forEach((t) => t.stop());
  void a.ctx?.close().catch(() => undefined);
  avisar();
  await avisarVoz(a.chatId, "salir").catch(() => undefined);
}

export function silenciar(si?: boolean) {
  if (!actual) return;
  actual.muteado = si ?? !actual.muteado;
  actual.mic.getAudioTracks().forEach((t) => (t.enabled = !actual!.muteado));
  if (actual.muteado) actual.yoHablando = false;
  avisar();
}


// Al cerrar o recargar la página, cuelga (no al pasar a otra app: la llamada sigue, como en WhatsApp).
if (typeof window !== "undefined") window.addEventListener("beforeunload", () => void salirDelChatDeVoz());

/** La llamada en curso (o null). */
export function useLlamada(): Llamada | null {
  return useSyncExternalStore(
    (cb) => {
      oyentes.add(cb);
      return () => {
        oyentes.delete(cb);
      };
    },
    () => foto,
    () => null
  );
}

/** Quién está en el chat de voz de cada chat. */
export function useChatVoz(): { enVoz: EnVoz[] } {
  const [lista, setLista] = useState<EnVoz[]>([]);
  useEffect(() => suscribirVoz(setLista), []);
  return { enVoz: lista };
}
