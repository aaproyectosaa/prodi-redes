// Chat de voz de los grupos (como WhatsApp), adentro de Prodi.
// Los celulares se conectan directo entre sí (WebRTC): el audio no pasa por Prodi, que solo los presenta
// (señales "oferta" / "respuesta"). El que entra llama a los que ya estaban; cada uno avisa cada 30 s que sigue.

import { useEffect, useState, useSyncExternalStore } from "react";
import { avisarVoz, enviarSenal, leerSenales, suscribirVoz, type EnVoz, type Senal } from "@/lib/db";
import { assertEditable } from "@/lib/redes/vistaComo";
import { auth } from "@/integrations/firebase/client";
import { callApi } from "@/lib/redes/api";
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
  /** Canal de video reservado al conectar: por ahí va la pantalla compartida (sin volver a negociar). */
  video?: RTCRtpTransceiver;
  /** Lo que llega por ese canal, y si la otra persona avisó que está compartiendo. */
  pantalla?: MediaStream | null;
  compartiendo?: boolean;
}

export interface Llamada {
  chatId: string;
  chatNombre: string;
  muteado: boolean;
  yoHablando: boolean;
  personas: { uid: string; nombre: string; estado: EstadoPar; hablando: boolean }[];
  /** Esta persona graba la llamada para la minuta (la que la abrió). */
  grabando: boolean;
  /** Estoy compartiendo mi pantalla. */
  compartiendo: boolean;
  /** El navegador deja compartir pantalla (en celulares, no). */
  puedeCompartir: boolean;
  /** Pantallas que están compartiendo los demás. */
  pantallas: { uid: string; nombre: string; stream: MediaStream }[];
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
  /** Llamada a la que entró (para la transcripción y la minuta). */
  inicioLlamada?: string | null;
  /** Tramo de mi voz que se está grabando para transcribir. */
  tramo?: { rec: MediaRecorder; desde: string; hablo: boolean; listo: Promise<void> };
  tramoTimer?: number;
  /** Mi pantalla compartida (o null). */
  pantalla?: MediaStream | null;
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
        grabando: !!actual.tramo,
        compartiendo: !!actual.pantalla,
        puedeCompartir: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia,
        pantallas: [...actual.pares.values()]
          .filter((p) => p.compartiendo && p.pantalla)
          .map((p) => ({ uid: p.uid, nombre: p.nombre, stream: p.pantalla! })),
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

function crearPar(uid: string, nombre: string, sesionRemota?: string, ofertante = false): Par {
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
  // Quien llama reserva el canal de video (quien atiende lo toma de la oferta, en atender()).
  if (ofertante) {
    par.video = pc.addTransceiver("video", { direction: "sendrecv" });
    const mia = a.pantalla?.getVideoTracks()[0];
    if (mia) void par.video.sender.replaceTrack(mia).catch(() => undefined);
  }
  pc.ontrack = (e) => {
    if (e.track.kind === "video") {
      par.pantalla = new MediaStream([e.track]);
      avisar();
      return;
    }
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
  };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    par.estado = s === "connected" ? "conectado" : s === "failed" || s === "disconnected" ? "sin-conexion" : "conectando";
    // Si entra alguien mientras comparto, que sepa que tiene que mostrar mi pantalla.
    if (s === "connected" && a.pantalla && actual === a) void enviarSenal(a.chatId, uid, "pantalla", { on: true, sesion: a.sesion }).catch(() => undefined);
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
  const par = crearPar(uid, nombre, undefined, true);
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
  if (s.tipo === "pantalla") {
    const p = a.pares.get(s.de);
    if (p && (!d.sesion || !p.sesionRemota || p.sesionRemota === d.sesion)) {
      p.compartiendo = !!(s.data as { on?: boolean }).on;
      avisar();
    }
    return;
  }
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
    // El canal de video que reservó quien llama: se usa para mandar (y recibir) pantalla.
    const tv = par.pc.getTransceivers().find((t) => t.receiver.track?.kind === "video");
    if (tv) {
      tv.direction = "sendrecv";
      par.video = tv;
      const mia = a.pantalla?.getVideoTracks()[0];
      if (mia) await tv.sender.replaceTrack(mia).catch(() => undefined);
    }
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
    if (a.yoHablando && a.tramo) a.tramo.hablo = true;
    avisar();
  });
  avisar();
  controlesDelSistema(a);
  try {
    const r = await avisarVoz(chatId, "entrar");
    a.inicioLlamada = r.inicio ?? null;
    empezarTramo(a);
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
  // Lo último que dije se transcribe antes de avisar que salgo (si era el último, la minuta lo incluye).
  await cerrarTramo(a);
  sesionDeLlamada(false);
  controlesDelSistema(null);
  a.mic.getTracks().forEach((t) => t.stop());
  a.pantalla?.getTracks().forEach((t) => t.stop());
  void a.ctx?.close().catch(() => undefined);
  avisar();
  const r = await avisarVoz(a.chatId, "salir").catch(() => null);
  // Era el último: el servidor ya está armando la minuta (llega al chat como PDF aunque cierres la app).
  if (r?.cerrada?.inicio) toast.message("La minuta llega al chat en PDF en un ratito.");
}

// ---- Minuta: cada uno transcribe su propia voz en partes cortas (solo si habló); al cortar, Prodi la arma ----

const TRAMO_MS = 40_000;

function tipoGrabacion(): string {
  const opciones = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];
  return opciones.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) ?? "";
}

function aBase64(b: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => mal(r.error);
    r.readAsDataURL(b);
  });
}

/** Graba un tramo de mi micrófono; al terminar (40 s o al salir) lo manda a transcribir si hablé. */
function empezarTramo(a: NonNullable<typeof actual>) {
  if (typeof MediaRecorder === "undefined" || !a.inicioLlamada) return;
  try {
    const mime = tipoGrabacion();
    const rec = new MediaRecorder(new MediaStream(a.mic.getAudioTracks()), { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    const partes: Blob[] = [];
    const tramo = { rec, desde: new Date().toISOString(), hablo: false, listo: Promise.resolve() };
    tramo.listo = new Promise<void>((ok) => {
      rec.ondataavailable = (e) => e.data.size && partes.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(partes, { type: rec.mimeType || mime || "audio/webm" });
        if (!tramo.hablo || blob.size < 2_000 || !a.inicioLlamada) return ok();
        void aBase64(blob)
          .then((data) => callApi("/api/ia/llamada-texto", { chat_id: a.chatId, inicio: a.inicioLlamada, desde: tramo.desde, data, mime: blob.type }))
          .catch(() => undefined)
          .finally(() => ok());
      };
    });
    rec.start();
    a.tramo = tramo;
    a.tramoTimer = window.setTimeout(() => {
      if (actual !== a) return;
      try {
        rec.stop();
      } catch {
        /* ya estaba parado */
      }
      empezarTramo(a);
    }, TRAMO_MS);
  } catch {
    a.tramo = undefined;
  }
}

/** Corta el tramo en curso y espera (máx. 20 s) a que se transcriba. */
async function cerrarTramo(a: NonNullable<typeof actual>) {
  window.clearTimeout(a.tramoTimer);
  const t = a.tramo;
  if (!t) return;
  try {
    if (t.rec.state !== "inactive") t.rec.stop();
  } catch {
    /* nada */
  }
  await Promise.race([t.listo, new Promise((ok) => window.setTimeout(ok, 20_000))]);
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

/** Comparte mi pantalla con todos los de la llamada (en compu; los celulares no lo permiten). */
export async function compartirPantalla() {
  const a = actual;
  if (!a || a.pantalla) return;
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
  if (actual !== a) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  // Texto y planillas nítidos antes que movimiento suave.
  track.contentHint = "detail";
  // Si se corta desde el navegador ("Dejar de compartir"), también se avisa.
  track.onended = () => dejarDeCompartir();
  a.pantalla = stream;
  for (const p of a.pares.values()) {
    if (p.video) await p.video.sender.replaceTrack(track).catch(() => undefined);
    void enviarSenal(a.chatId, p.uid, "pantalla", { on: true, sesion: a.sesion }).catch(() => undefined);
  }
  avisar();
}

export function dejarDeCompartir() {
  const a = actual;
  if (!a?.pantalla) return;
  a.pantalla.getTracks().forEach((t) => t.stop());
  a.pantalla = null;
  for (const p of a.pares.values()) {
    if (p.video) void p.video.sender.replaceTrack(null).catch(() => undefined);
    void enviarSenal(a.chatId, p.uid, "pantalla", { on: false, sesion: a.sesion }).catch(() => undefined);
  }
  avisar();
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
