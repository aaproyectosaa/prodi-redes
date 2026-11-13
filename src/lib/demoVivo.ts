// Demo en vivo: la sala (WebRTC directo entre celulares y quien mira) y las llamadas a /api/publico/demo-*.
// Quién manda video a quién: cada cámara → al presentador y a cada lead; el presentador (su voz) → a cada lead.
// El que manda arma la conexión (oferta) y el otro contesta. Prodi solo pasa esas señales, la lista de quién está
// adentro y el chat (api/_lib/demo-vivo.ts).

import { callApi } from "@/lib/redes/api";

export type TipoDemo = "camara" | "presentador" | "lead";
export type EstadoDemo = "programada" | "en_vivo" | "terminada";

export interface DemoPanel {
  id: string;
  titulo: string;
  fecha: string | null;
  estado: EstadoDemo;
  creada_por_nombre: string;
  created_at: string;
  inicio_at: string | null;
  fin_at: string | null;
  visitas: { nombre: string; email?: string; at: string }[];
  interesados: { nombre: string; contacto: string; at: string }[];
  minuta: MinutaDemo | null;
  link: string;
}

export interface MinutaDemo {
  estado: "armando" | "lista" | "vacia" | "error";
  resumen?: string;
  temas?: string[];
  acuerdos?: string[];
  tareas?: { tarea: string; responsable: string | null; fecha: string | null }[];
  enviada_a?: string[];
  at: string;
}

export interface Credencial {
  d: string;
  pid: string;
  llave: string;
}

export interface MensajeDemo {
  id: number;
  pid: string;
  nombre: string;
  tipo: string;
  texto: string;
  creado: string;
}

/** Sin usuario (lead y cámaras). */
export async function apiDemo<T>(accion: string, datos: Record<string, unknown>): Promise<T> {
  const r = await fetch(`/api/publico/${accion}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || "No se pudo conectar. Probá de nuevo.");
  return j;
}
/** Con usuario (el panel de la empresa). */
export const apiPanel = <T,>(accion: string, datos: Record<string, unknown>) => callApi<T>(`/api/publico/${accion}`, datos);

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

/** Espera a juntar los caminos de conexión (sin mandarlos de a uno): como mucho 2,5 s. */
function juntarCaminos(pc: RTCPeerConnection, conRespaldo = false) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((ok) => {
    const fin = () => {
      pc.removeEventListener("icegatheringstatechange", cambio);
      clearTimeout(t);
      ok();
    };
    const cambio = () => pc.iceGatheringState === "complete" && fin();
    pc.addEventListener("icegatheringstatechange", cambio);
    // Con el respaldo (TURN) los caminos por Cloudflare tardan un poco más en aparecer.
    const t = setTimeout(fin, conRespaldo ? 4000 : 2500);
  });
}

export interface Participante {
  pid: string;
  tipo: TipoDemo;
  nombre: string;
}
export interface Remoto {
  pid: string;
  tipo: TipoDemo;
  nombre: string;
  stream: MediaStream;
  conectado: boolean;
}

interface Par {
  pid: string;
  pc: RTCPeerConnection;
  envio: boolean;
  sesion: string;
  creado: number;
  stream?: MediaStream;
}

const SEG = 1000;
/** Con cada persona puede haber dos conexiones: la que yo mando (e:) y la que recibo (r:). */
const clave = (envio: boolean, pid: string) => `${envio ? "e" : "r"}:${pid}`;

/**
 * Calidad del video que mando: más margen (hasta 2,5 Mbps) y, si la conexión no da, que baje los cuadros por segundo
 * antes que la definición (con movimiento se veía pixelado).
 */
async function ajustarCalidad(pc: RTCPeerConnection) {
  for (const s of pc.getSenders()) {
    if (s.track?.kind !== "video") continue;
    try {
      const p = s.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      if (!p.encodings?.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = 2_500_000;
      p.encodings[0].maxFramerate = 30;
      p.degradationPreference = "maintain-resolution";
      await s.setParameters(p);
    } catch {
      /* algunos navegadores no dejan cambiarlo: sigue con lo de siempre */
    }
  }
}

/** Una sala de demo: se conecta, avisa que sigue, arma las conexiones y junta el chat. */
export class SalaDemo {
  participantes: Participante[] = [];
  remotos: Remoto[] = [];
  mensajes: MensajeDemo[] = [];
  estado: EstadoDemo = "en_vivo";
  /** El servidor ya no me tiene adentro (me sacaron o se cortó demasiado). */
  fuera = false;
  /** El cliente que muestra su cámara en grande (lo autorizó quien presenta). */
  mostrando: { pid: string; nombre: string } | null = null;
  private pares = new Map<string, Par>();
  private desde = 0;
  private timer = 0;
  private cerrada = false;
  private ocupado = false;
  private escuchas = new Set<() => void>();

  constructor(
    readonly cred: Credencial,
    readonly tipo: TipoDemo,
    private local: MediaStream | null
  ) {}

  suscribir(fn: () => void) {
    this.escuchas.add(fn);
    return () => {
      this.escuchas.delete(fn);
    };
  }
  private avisar() {
    this.escuchas.forEach((f) => f());
  }

  /** Servidores para conectarse que da Prodi (con el respaldo de Cloudflare si está); si falla, los de siempre. */
  private ice: RTCIceServer[] | null = null;
  private respaldo = false;

  iniciar() {
    void apiDemo<{ iceServers: RTCIceServer[]; respaldo: boolean }>("demo-ice", { ...this.cred })
      .then((r) => {
        if (r.iceServers?.length) this.ice = r.iceServers;
        this.respaldo = !!r.respaldo;
      })
      .catch(() => undefined)
      .finally(() => void this.vuelta());
  }

  /** Cambia lo que mando (prender o apagar la cámara, el micrófono del lead): rearma las conexiones de envío. */
  cambiarLocal(stream: MediaStream | null) {
    this.local = stream;
    for (const [k, p] of this.pares) if (p.envio) this.cerrarPar(k);
    if (stream) this.ordenar();
    this.avisar();
  }
  get miStream() {
    return this.local;
  }

  /**
   * A quién le mando lo mío: las cámaras a todos menos a otras cámaras; el presentador (voz y su cámara) a los leads;
   * el lead (si prendió cámara o micrófono) a todos los que miran, como una videollamada.
   */
  private aQuienMando(p: Participante) {
    if (this.tipo === "camara") return p.tipo === "presentador" || p.tipo === "lead";
    if (this.tipo === "presentador") return p.tipo === "lead";
    return p.tipo === "presentador" || p.tipo === "lead";
  }

  private async vuelta() {
    if (this.cerrada) return;
    if (!this.ocupado) {
      this.ocupado = true;
      try {
        const r = await apiDemo<{ estado: EstadoDemo; fuera?: boolean; mostrando?: { pid: string; nombre: string } | null; participantes: Participante[]; senales: { de: string; tipo: string; data: { sdp?: string; sesion?: string } }[]; mensajes: MensajeDemo[] }>(
          "demo-latido",
          { ...this.cred, desde: this.desde }
        );
        this.estado = r.estado;
        this.fuera = !!r.fuera;
        this.mostrando = r.mostrando ?? null;
        this.participantes = r.participantes.filter((p) => p.pid !== this.cred.pid);
        if (r.mensajes.length) {
          this.mensajes = [...this.mensajes, ...r.mensajes].slice(-200);
          this.desde = r.mensajes[r.mensajes.length - 1].id;
        }
        for (const s of r.senales) await this.recibir(s.de, s.tipo, s.data);
        this.ordenar();
      } catch {
        /* sin conexión un momento: se reintenta en la próxima vuelta */
      } finally {
        this.ocupado = false;
      }
      this.avisar();
    }
    if (this.estado === "terminada") return this.cerrarTodo();
    // Al principio seguido (para conectar rápido), después más tranquilo.
    const conectando = [...this.pares.values()].some((p) => p.pc.connectionState !== "connected");
    this.timer = window.setTimeout(() => void this.vuelta(), conectando || this.pares.size === 0 ? 1 * SEG : 2 * SEG);
  }

  /** Cierra lo que se cayó y arma lo que falta. */
  private ordenar() {
    const presentes = new Set(this.participantes.map((p) => p.pid));
    for (const [k, par] of this.pares) {
      const st = par.pc.connectionState;
      const trabado = st !== "connected" && Date.now() - par.creado > 15 * SEG;
      if (!presentes.has(par.pid) || st === "failed" || st === "closed" || trabado) this.cerrarPar(k);
    }
    if (this.local?.getTracks().length && this.estado === "en_vivo") {
      for (const p of this.participantes) if (this.aQuienMando(p) && !this.pares.has(clave(true, p.pid))) void this.ofrecer(p.pid);
    }
    this.actualizarRemotos();
  }

  private nuevoPc(pid: string, envio: boolean, sesion: string): Par {
    const pc = new RTCPeerConnection({ iceServers: this.ice ?? servidoresIce() });
    const par: Par = { pid, pc, envio, sesion, creado: Date.now() };
    pc.onconnectionstatechange = () => {
      this.actualizarRemotos();
      this.avisar();
    };
    pc.ontrack = (e) => {
      // Cada pista nueva (ej. llega el video además de la voz) arma un stream nuevo, así el video se vuelve a dibujar.
      const pistas = [...(par.stream?.getTracks() ?? []).filter((t) => t.id !== e.track.id), e.track];
      par.stream = new MediaStream(pistas);
      this.actualizarRemotos();
      this.avisar();
    };
    this.pares.set(clave(envio, pid), par);
    return par;
  }

  private async ofrecer(pid: string) {
    const local = this.local;
    if (!local) return;
    const sesion = Math.random().toString(36).slice(2, 10);
    const par = this.nuevoPc(pid, true, sesion);
    for (const t of local.getTracks()) {
      // Cámaras y lo que muestra un cliente: que prefiera nitidez (si falta conexión, baja la fluidez en vez de pixelarse).
      if (t.kind === "video" && "contentHint" in t) t.contentHint = "detail";
      par.pc.addTransceiver(t, { direction: "sendonly", streams: [local] });
    }
    try {
      await par.pc.setLocalDescription(await par.pc.createOffer());
      await juntarCaminos(par.pc, this.respaldo);
      if (this.pares.get(clave(true, pid)) !== par) return;
      await apiDemo("demo-senal", { ...this.cred, para: pid, tipo: "oferta", data: { sdp: par.pc.localDescription?.sdp, sesion } });
    } catch {
      this.cerrarPar(clave(true, pid));
    }
  }

  private async recibir(de: string, tipo: string, data: { sdp?: string; sesion?: string }) {
    if (tipo === "oferta" && data.sdp) {
      this.cerrarPar(clave(false, de));
      const par = this.nuevoPc(de, false, data.sesion ?? "");
      try {
        await par.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        await par.pc.setLocalDescription(await par.pc.createAnswer());
        await juntarCaminos(par.pc, this.respaldo);
        await apiDemo("demo-senal", { ...this.cred, para: de, tipo: "respuesta", data: { sdp: par.pc.localDescription?.sdp, sesion: data.sesion } });
      } catch {
        this.cerrarPar(clave(false, de));
      }
    } else if (tipo === "respuesta" && data.sdp) {
      const par = this.pares.get(clave(true, de));
      if (par && par.sesion === data.sesion && par.pc.signalingState === "have-local-offer") {
        await par.pc.setRemoteDescription({ type: "answer", sdp: data.sdp }).catch(() => this.cerrarPar(clave(true, de)));
        await ajustarCalidad(par.pc);
      }
    } else if (tipo === "chau") {
      this.cerrarPar(clave(true, de));
      this.cerrarPar(clave(false, de));
    }
  }

  private cerrarPar(k: string) {
    const p = this.pares.get(k);
    if (!p) return;
    this.pares.delete(k);
    p.pc.onconnectionstatechange = null;
    p.pc.ontrack = null;
    p.pc.close();
    this.actualizarRemotos();
  }

  private actualizarRemotos() {
    const nombres = new Map(this.participantes.map((p) => [p.pid, p]));
    const lista: Remoto[] = [];
    for (const par of this.pares.values()) {
      if (par.envio || !par.stream) continue;
      const p = nombres.get(par.pid);
      lista.push({ pid: par.pid, tipo: p?.tipo ?? "camara", nombre: p?.nombre ?? "Cámara", stream: par.stream, conectado: par.pc.connectionState === "connected" });
    }
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
    this.remotos = lista;
  }

  /** Cuántos leads están mirando. */
  get mirando() {
    return this.participantes.filter((p) => p.tipo === "lead").length;
  }
  /** A cuántos les estoy mandando video y ya se conectaron. */
  get enviandoA() {
    return [...this.pares.values()].filter((p) => p.envio && p.pc.connectionState === "connected").length;
  }

  /** El cliente pide mostrar su cámara; quien presenta acepta o rechaza; cualquiera de los dos lo corta. */
  pedirMostrar() {
    return apiDemo("demo-pedir-mostrar", { ...this.cred });
  }
  autorizarMostrar(cliente: string, si: boolean) {
    return apiDemo("demo-autorizar-mostrar", { ...this.cred, cliente, si });
  }
  dejarMostrar() {
    this.mostrando = null;
    this.avisar();
    return apiDemo("demo-dejar-mostrar", { ...this.cred });
  }

  enviarMensaje(texto: string) {
    return apiDemo("demo-mensaje", { ...this.cred, texto });
  }

  private cerrarTodo() {
    for (const k of [...this.pares.keys()]) this.cerrarPar(k);
    this.avisar();
  }

  /** Salir: corta todo y avisa al servidor. */
  async salir() {
    if (this.cerrada) return;
    this.cerrada = true;
    clearTimeout(this.timer);
    this.cerrarTodo();
    await apiDemo("demo-salir", { ...this.cred }).catch(() => undefined);
  }
}

function aBase64(b: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => mal(r.error);
    r.readAsDataURL(b);
  });
}

/**
 * Graba la voz de quien presenta en partes de 30 s y las manda a pasar a texto (para la minuta). Devuelve cómo
 * cortarla (manda lo último que quedó).
 */
export function grabarParaMinuta(mic: MediaStream, cred: Credencial): () => void {
  if (typeof MediaRecorder === "undefined" || !mic.getAudioTracks().length) return () => undefined;
  const tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const mime = tipos.find((t) => MediaRecorder.isTypeSupported?.(t));
  let activo = true;
  let rec: MediaRecorder | null = null;
  let timer = 0;
  const tramo = () => {
    if (!activo) return;
    const partes: Blob[] = [];
    const desde = new Date().toISOString();
    try {
      rec = new MediaRecorder(new MediaStream(mic.getAudioTracks()), { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    } catch {
      return;
    }
    rec.ondataavailable = (e) => e.data.size && partes.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(partes, { type: rec?.mimeType || mime || "audio/webm" });
      if (blob.size >= 3_000) void aBase64(blob).then((data) => apiDemo("demo-texto", { ...cred, data, mime: blob.type, desde }).catch(() => undefined));
      tramo();
    };
    rec.start();
    timer = window.setTimeout(() => rec?.state === "recording" && rec.stop(), 30_000);
  };
  tramo();
  return () => {
    clearTimeout(timer);
    if (rec?.state === "recording") rec.stop();
    activo = false;
  };
}

/** Mantiene la pantalla prendida (celular cámara). Devuelve cómo soltarla. */
export async function pantallaPrendida(): Promise<() => void> {
  type Lock = { release: () => Promise<void> };
  const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Lock> } };
  let lock: Lock | null = null;
  const pedir = async () => {
    try {
      lock = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      lock = null;
    }
  };
  await pedir();
  const alVolver = () => document.visibilityState === "visible" && void pedir();
  document.addEventListener("visibilitychange", alVolver);
  return () => {
    document.removeEventListener("visibilitychange", alVolver);
    void lock?.release().catch(() => undefined);
  };
}
