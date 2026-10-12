// Chat de voz de los grupos (como WhatsApp), adentro de Prodi.
// Los celulares se conectan directo entre sí (WebRTC): el audio no pasa por Prodi, que solo los presenta
// (señales "oferta" / "respuesta"). El que entra llama a los que ya estaban; cada uno avisa cada 30 s que sigue.

import { useEffect, useState, useSyncExternalStore } from "react";
import { avisarVoz, enviarSenal, leerSenales, suscribirVoz, type EnVoz, type Senal } from "@/lib/db";
import { assertEditable } from "@/lib/redes/vistaComo";
import { auth } from "@/integrations/firebase/client";
import { callApi } from "@/lib/redes/api";
import { subirASesion } from "@/utils/drive/driveApi";
import { toast } from "sonner";

const LATIDO_MS = 30_000;

/** Mi id (para resolver quién gana si dos se llaman a la vez). */
function uidActual(): string {
  return auth.currentUser?.uid ?? "";
}

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
  /** Sesión de la otra persona (cambia cada vez que entra): las señales viejas no tocan la conexión nueva. */
  sesionRemota?: string;
}

export interface Llamada {
  chatId: string;
  chatNombre: string;
  muteado: boolean;
  yoHablando: boolean;
  personas: { uid: string; nombre: string; estado: EstadoPar; hablando: boolean }[];
  /** Esta persona graba la llamada para la minuta (la que la abrió). */
  grabando: boolean;
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
  uid: string;
  /** Esta entrada a la llamada (al salir y volver a entrar es otra). */
  sesion: string;
  medirMio?: () => void;
  finPresencia?: () => void;
  medirOtros?: number;
  /** Grabación para la minuta (solo quien abrió la llamada): mezcla de su micrófono y los de los demás. */
  grabacion?: { rec: MediaRecorder; partes: Blob[]; mezcla: MediaStreamAudioDestinationNode; desde: number; nombres: Set<string>; mime: string };
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
        grabando: !!actual.grabacion,
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

/** Espera a juntar los caminos posibles (máx. 1,2 s: alcanza para la red local y la pública) y manda todo junto. */
function esperarIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((ok) => {
    const fin = () => {
      pc.removeEventListener("icegatheringstatechange", alCambiar);
      ok();
    };
    const alCambiar = () => pc.iceGatheringState === "complete" && fin();
    pc.addEventListener("icegatheringstatechange", alCambiar);
    window.setTimeout(fin, 1_200);
  });
}

function crearPar(uid: string, nombre: string, sesionRemota?: string): Par {
  const a = actual!;
  // Si ya había una conexión con esa persona, se cierra del todo (que no queden dos sonando).
  const vieja = a.pares.get(uid);
  if (vieja) {
    vieja.pc.close();
    vieja.audio.pause();
    vieja.audio.srcObject = null;
  }
  const pc = new RTCPeerConnection({ iceServers: servidoresIce() });
  a.mic.getAudioTracks().forEach((t) => pc.addTrack(t, a.mic));
  const audio = new Audio();
  audio.autoplay = true;
  audio.setAttribute("playsinline", "");
  const par: Par = { uid, nombre, pc, audio, estado: "conectando", hablando: false, desde: Date.now(), sesionRemota };
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    // A la grabación de la minuta va una copia aparte (nunca a los parlantes).
    if (a.grabacion && a.ctx) {
      try {
        a.ctx.createMediaStreamSource(new MediaStream([e.track.clone()])).connect(a.grabacion.mezcla);
      } catch {
        /* sin mezcla para esta persona */
      }
    }
    a.grabacion?.nombres.add(nombre);
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
  p.audio.pause();
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
  await enviarSenal(a.chatId, uid, "oferta", { type: "offer", sdp: par.pc.localDescription?.sdp, sesion: a.sesion }).catch(() => undefined);
}

async function atender(s: Senal) {
  const a = actual;
  if (!a || s.chat_id !== a.chatId) return;
  const d = s.data as { sdp?: string; sesion?: string; para_sesion?: string };
  if (s.tipo === "chau") {
    // Solo si es de la conexión actual con esa persona (un "chau" viejo no corta la nueva).
    const p = a.pares.get(s.de);
    if (p && (!d.sesion || !p.sesionRemota || p.sesionRemota === d.sesion)) cerrarPar(s.de);
    return;
  }
  if (s.tipo === "oferta" && d.sdp) {
    // Los dos se llamaron a la vez: gana la oferta de quien tiene el id más chico; el otro la descarta.
    const mia = a.pares.get(s.de);
    if (mia && mia.pc.signalingState === "have-local-offer" && a.uid < s.de) return;
    const par = crearPar(s.de, s.de_nombre || "Alguien", d.sesion);
    await par.pc.setRemoteDescription({ type: "offer", sdp: s.data.sdp });
    const resp = await par.pc.createAnswer();
    await par.pc.setLocalDescription(resp);
    await esperarIce(par.pc);
    if (actual !== a) return;
    await enviarSenal(a.chatId, s.de, "respuesta", { type: "answer", sdp: par.pc.localDescription?.sdp, sesion: a.sesion, para_sesion: d.sesion }).catch(() => undefined);
    return;
  }
  if (s.tipo === "respuesta" && d.sdp) {
    // Solo respuestas a ESTA entrada (las de una entrada anterior se ignoran).
    if (d.para_sesion && d.para_sesion !== a.sesion) return;
    const par = a.pares.get(s.de);
    if (par && par.pc.signalingState === "have-local-offer") {
      par.sesionRemota = d.sesion;
      await par.pc.setRemoteDescription({ type: "answer", sdp: d.sdp }).catch(() => undefined);
    }
  }
}

/** Pregunta seguido por señales nuevas (cada medio segundo al principio, después cada 1,5 s). */
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
  }, Date.now() - inicio < 20_000 ? 500 : 1_500);
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
    sesionDeLlamada(true);
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
  actual = {
    chatId,
    chatNombre,
    mic,
    muteado: false,
    yoHablando: false,
    pares: new Map(),
    latido: 0,
    sondeo: 0,
    ctx,
    uid: uidActual(),
    sesion: Math.random().toString(36).slice(2, 12),
  };
  const a = actual;
  a.medirMio = medidor(ctx, mic, (h) => {
    a.yoHablando = h && !a.muteado;
    avisar();
  });
  avisar();
  controlesDelSistema(a);
  try {
    const r = await avisarVoz(chatId, "entrar");
    if (!(r.adentro ?? []).length) empezarGrabacion(a);
    a.latido = window.setInterval(() => void avisarVoz(chatId, "latido").catch(() => undefined), LATIDO_MS);
    sondearSenales(Date.now());
    a.medirOtros = window.setInterval(() => {
      let cambio = false;
      for (const p of a.pares.values()) {
        let nivel = 0;
        for (const r of p.pc.getReceivers()) for (const f of r.getSynchronizationSources?.() ?? []) nivel = Math.max(nivel, f.audioLevel ?? 0);
        const habla = nivel > 0.03;
        if (habla !== p.hablando) {
          p.hablando = habla;
          cambio = true;
        }
      }
      if (cambio) avisar();
    }, 300);
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
  window.clearInterval(a.medirOtros);
  a.medirMio?.();
  for (const p of a.pares.values()) {
    void enviarSenal(a.chatId, p.uid, "chau", { sesion: a.sesion }).catch(() => undefined);
    p.medir?.();
    p.pc.close();
    p.audio.pause();
    p.audio.srcObject = null;
  }
  const grabado = a.grabacion ? await terminarGrabacion(a.grabacion) : null;
  sesionDeLlamada(false);
  controlesDelSistema(null);
  a.mic.getTracks().forEach((t) => t.stop());
  void a.ctx?.close().catch(() => undefined);
  avisar();
  await avisarVoz(a.chatId, "salir").catch(() => undefined);
  if (grabado) void armarMinuta(a.chatId, grabado);
}

// ---- Minuta: graba quien abrió la llamada; al salir sube el audio a Drive y Prodi deja la minuta en el chat ----

const MINIMO_MINUTA_MS = 30_000;

function tipoGrabacion(): string {
  const opciones = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];
  return opciones.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) ?? "";
}

function empezarGrabacion(a: NonNullable<typeof actual>) {
  if (!a.ctx || typeof MediaRecorder === "undefined") return;
  try {
    const mezcla = a.ctx.createMediaStreamDestination();
    a.ctx.createMediaStreamSource(a.mic).connect(mezcla);
    const mime = tipoGrabacion();
    const rec = new MediaRecorder(mezcla.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    const partes: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && partes.push(e.data);
    rec.start(10_000);
    a.grabacion = { rec, partes, mezcla, desde: Date.now(), nombres: new Set(), mime: rec.mimeType || mime || "audio/webm" };
    avisar();
  } catch {
    a.grabacion = undefined;
  }
}

function terminarGrabacion(g: NonNullable<NonNullable<typeof actual>["grabacion"]>): Promise<{ blob: Blob; ms: number; nombres: string[]; mime: string } | null> {
  const ms = Date.now() - g.desde;
  return new Promise((ok) => {
    const fin = () => ok(ms >= MINIMO_MINUTA_MS && g.partes.length ? { blob: new Blob(g.partes, { type: g.mime }), ms, nombres: [...g.nombres], mime: g.mime } : null);
    if (g.rec.state === "inactive") return fin();
    g.rec.onstop = fin;
    try {
      g.rec.stop();
    } catch {
      fin();
    }
  });
}

async function armarMinuta(chatId: string, g: { blob: Blob; ms: number; nombres: string[]; mime: string }) {
  const id = toast.loading("Armando la minuta de la llamada…");
  try {
    const ext = g.mime.includes("mp4") ? "m4a" : g.mime.includes("ogg") ? "ogg" : "webm";
    const tipo = g.mime.split(";")[0];
    const nombre = `Llamada ${new Date().toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }).replace(/[/:]/g, "-")}.${ext}`;
    const { subida, url } = await callApi<{ subida: string; url: string }>("/api/drive/chat-subida", { chat_id: chatId, nombre, mime: tipo, size: g.blob.size });
    try {
      await subirASesion({ sessionUri: url, file: new File([g.blob], nombre, { type: tipo }), mime: tipo });
    } catch {
      /* a veces el navegador no deja leer la última respuesta aunque subió: el servidor lo confirma */
    }
    await callApi("/api/ia/minuta-llamada", { chat_id: chatId, subida, minutos: Math.round(g.ms / 60_000), participantes: g.nombres });
    toast.success("La minuta quedó en el chat", { id });
  } catch (err) {
    toast.error(err instanceof Error ? `No se pudo armar la minuta: ${err.message}` : "No se pudo armar la minuta", { id });
  }
}

// ---- Al volver a la app (iPhone pausa el micrófono en segundo plano): se recupera micrófono y audio ----
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const a = actual;
    if (!a || document.visibilityState !== "visible") return;
    void a.ctx?.resume().catch(() => undefined);
    for (const p of a.pares.values()) void p.audio.play().catch(() => undefined);
    const vivo = a.mic.getAudioTracks().some((t) => t.readyState === "live");
    if (vivo) return;
    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((nuevo) => {
        if (actual !== a) return nuevo.getTracks().forEach((t) => t.stop());
        const pista = nuevo.getAudioTracks()[0];
        if (!pista) return;
        pista.enabled = !a.muteado;
        for (const p of a.pares.values()) for (const s of p.pc.getSenders()) if (s.track?.kind === "audio" || !s.track) void s.replaceTrack(pista);
        a.mic = nuevo;
        if (a.grabacion && a.ctx) a.ctx.createMediaStreamSource(nuevo).connect(a.grabacion.mezcla);
      })
      .catch(() => toast.error("Se cortó el micrófono. Salí y volvé a entrar al chat de voz."));
  });
}

// ---- iPhone: que iOS la trate como una llamada (Safari 17+) y que aparezca en los controles de audio ----

type ConAudioSession = Navigator & { audioSession?: { type: string } };

/** "play-and-record": iOS la maneja como llamada (micrófono + parlante) y no la mezcla con otros audios. */
function sesionDeLlamada(si: boolean) {
  try {
    const s = (navigator as ConAudioSession).audioSession;
    if (s) s.type = si ? "play-and-record" : "auto";
  } catch {
    /* navegador sin audioSession */
  }
}

/** La llamada en los controles del sistema (pantalla bloqueada / centro de control): título, silenciar y colgar. */
function controlesDelSistema(a: NonNullable<typeof actual> | null) {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms) return;
  try {
    if (!a) {
      ms.metadata = null;
      ms.playbackState = "none";
      for (const accion of ["hangup", "togglemicrophone", "pause", "stop"]) ms.setActionHandler(accion as MediaSessionAction, null);
      return;
    }
    ms.metadata = new MediaMetadata({ title: `Chat de voz · ${a.chatNombre}`, artist: "Prodi" });
    ms.playbackState = "playing";
    const colgar = () => void salirDelChatDeVoz();
    for (const [accion, fn] of [
      ["hangup", colgar],
      ["stop", colgar],
      ["togglemicrophone", () => silenciar()],
      ["pause", () => silenciar(true)],
    ] as const) {
      try {
        ms.setActionHandler(accion as MediaSessionAction, fn);
      } catch {
        /* acción no soportada en este navegador */
      }
    }
  } catch {
    /* sin controles del sistema */
  }
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
