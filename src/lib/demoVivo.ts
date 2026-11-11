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
  visitas: { nombre: string; at: string }[];
  interesados: { nombre: string; contacto: string; at: string }[];
  link: string;
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
function juntarCaminos(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((ok) => {
    const fin = () => {
      pc.removeEventListener("icegatheringstatechange", cambio);
      clearTimeout(t);
      ok();
    };
    const cambio = () => pc.iceGatheringState === "complete" && fin();
    pc.addEventListener("icegatheringstatechange", cambio);
    const t = setTimeout(fin, 2500);
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
  pc: RTCPeerConnection;
  envio: boolean;
  sesion: string;
  creado: number;
  stream?: MediaStream;
}

const SEG = 1000;

/** Una sala de demo: se conecta, avisa que sigue, arma las conexiones y junta el chat. */
export class SalaDemo {
  participantes: Participante[] = [];
  remotos: Remoto[] = [];
  mensajes: MensajeDemo[] = [];
  estado: EstadoDemo = "en_vivo";
  /** El servidor ya no me tiene adentro (me sacaron o se cortó demasiado). */
  fuera = false;
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

  iniciar() {
    void this.vuelta();
  }

  /** Cambia lo que mando (ej. el presentador prende o apaga el micrófono): rearma las conexiones de envío. */
  cambiarLocal(stream: MediaStream | null) {
    this.local = stream;
    for (const [pid, p] of this.pares) if (p.envio) this.cerrarPar(pid);
  }

  private aQuienMando(p: Participante) {
    if (this.tipo === "camara") return p.tipo === "presentador" || p.tipo === "lead";
    if (this.tipo === "presentador") return p.tipo === "lead";
    return false;
  }

  private async vuelta() {
    if (this.cerrada) return;
    if (!this.ocupado) {
      this.ocupado = true;
      try {
        const r = await apiDemo<{ estado: EstadoDemo; fuera?: boolean; participantes: Participante[]; senales: { de: string; tipo: string; data: { sdp?: string; sesion?: string } }[]; mensajes: MensajeDemo[] }>(
          "demo-latido",
          { ...this.cred, desde: this.desde }
        );
        this.estado = r.estado;
        this.fuera = !!r.fuera;
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
    const presentes = new Map(this.participantes.map((p) => [p.pid, p]));
    for (const [pid, par] of this.pares) {
      const st = par.pc.connectionState;
      const trabado = st !== "connected" && Date.now() - par.creado > 15 * SEG;
      if (!presentes.has(pid) || st === "failed" || st === "closed" || trabado) this.cerrarPar(pid);
    }
    if (!this.local || this.estado !== "en_vivo") return;
    for (const p of this.participantes) if (this.aQuienMando(p) && !this.pares.has(p.pid)) void this.ofrecer(p.pid);
    this.actualizarRemotos();
  }

  private nuevoPc(pid: string, envio: boolean, sesion: string): Par {
    const pc = new RTCPeerConnection({ iceServers: servidoresIce() });
    const par: Par = { pc, envio, sesion, creado: Date.now() };
    pc.onconnectionstatechange = () => {
      this.actualizarRemotos();
      this.avisar();
    };
    pc.ontrack = (e) => {
      par.stream = e.streams[0] ?? new MediaStream([e.track]);
      this.actualizarRemotos();
      this.avisar();
    };
    this.pares.set(pid, par);
    return par;
  }

  private async ofrecer(pid: string) {
    const local = this.local;
    if (!local) return;
    const sesion = Math.random().toString(36).slice(2, 10);
    const par = this.nuevoPc(pid, true, sesion);
    for (const t of local.getTracks()) par.pc.addTransceiver(t, { direction: "sendonly", streams: [local] });
    try {
      await par.pc.setLocalDescription(await par.pc.createOffer());
      await juntarCaminos(par.pc);
      if (this.pares.get(pid) !== par) return;
      await apiDemo("demo-senal", { ...this.cred, para: pid, tipo: "oferta", data: { sdp: par.pc.localDescription?.sdp, sesion } });
    } catch {
      this.cerrarPar(pid);
    }
  }

  private async recibir(de: string, tipo: string, data: { sdp?: string; sesion?: string }) {
    if (tipo === "oferta" && data.sdp) {
      this.cerrarPar(de);
      const par = this.nuevoPc(de, false, data.sesion ?? "");
      try {
        await par.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        await par.pc.setLocalDescription(await par.pc.createAnswer());
        await juntarCaminos(par.pc);
        await apiDemo("demo-senal", { ...this.cred, para: de, tipo: "respuesta", data: { sdp: par.pc.localDescription?.sdp, sesion: data.sesion } });
      } catch {
        this.cerrarPar(de);
      }
    } else if (tipo === "respuesta" && data.sdp) {
      const par = this.pares.get(de);
      if (par?.envio && par.sesion === data.sesion && par.pc.signalingState === "have-local-offer") {
        await par.pc.setRemoteDescription({ type: "answer", sdp: data.sdp }).catch(() => this.cerrarPar(de));
      }
    } else if (tipo === "chau") this.cerrarPar(de);
  }

  private cerrarPar(pid: string) {
    const p = this.pares.get(pid);
    if (!p) return;
    this.pares.delete(pid);
    p.pc.onconnectionstatechange = null;
    p.pc.ontrack = null;
    p.pc.close();
    this.actualizarRemotos();
  }

  private actualizarRemotos() {
    const nombres = new Map(this.participantes.map((p) => [p.pid, p]));
    const lista: Remoto[] = [];
    for (const [pid, par] of this.pares) {
      if (par.envio || !par.stream) continue;
      const p = nombres.get(pid);
      lista.push({ pid, tipo: p?.tipo ?? "camara", nombre: p?.nombre ?? "Cámara", stream: par.stream, conectado: par.pc.connectionState === "connected" });
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

  enviarMensaje(texto: string) {
    return apiDemo("demo-mensaje", { ...this.cred, texto });
  }

  private cerrarTodo() {
    for (const pid of [...this.pares.keys()]) this.cerrarPar(pid);
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
