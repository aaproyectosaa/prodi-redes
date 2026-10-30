// Grabación de reuniones en el navegador, una sola a la vez para toda la app (sigue grabando aunque cambies de
// pantalla). Cada pedacito se guarda en el teléfono (IndexedDB) apenas se graba: si el navegador se cierra o el
// celular corta el micrófono, no se pierde lo grabado y al volver se sigue en una parte nueva.
//
// - Android (Chrome): sigue grabando con la pantalla bloqueada.
// - iPhone / iPad: iOS apaga el micrófono al bloquear; se mantiene la pantalla prendida mientras graba y, si igual
//   se corta, al volver arranca la parte siguiente sola. La minuta junta todas las partes en orden.

import { useSyncExternalStore } from "react";
import { plataforma } from "@/lib/instalar";

export type ModoGrabacion = "presencial" | "llamada";
export type MetaGrabacion = { reunionId: string; titulo: string; clienteNombre: string; fecha: string };
export type FaseGrabacion = "inactiva" | "grabando" | "pausada" | "cortada";

export interface EstadoGrabacion {
  meta: MetaGrabacion | null;
  modo: ModoGrabacion;
  fase: FaseGrabacion;
  /** ms grabados antes del tramo actual (las pausas no cuentan). */
  acumulado: number;
  /** Cuándo arrancó el tramo actual (si está grabando). */
  desde: number;
  parte: number;
  /** Volumen de los últimos instantes (0 a 1), para dibujar las barras. */
  niveles: number[];
}

const BARRAS = 28;
const INICIAL: EstadoGrabacion = { meta: null, modo: "presencial", fase: "inactiva", acumulado: 0, desde: 0, parte: 1, niveles: Array(BARRAS).fill(0) };

let estado: EstadoGrabacion = INICIAL;
const oyentes = new Set<() => void>();
function cambiar(patch: Partial<EstadoGrabacion>) {
  estado = { ...estado, ...patch };
  oyentes.forEach((o) => o());
}

export function useGrabacion(): EstadoGrabacion {
  return useSyncExternalStore(
    (o) => {
      oyentes.add(o);
      return () => oyentes.delete(o);
    },
    () => estado
  );
}

export const segundosGrabados = (e: EstadoGrabacion, ahora = Date.now()) =>
  Math.floor((e.acumulado + (e.fase === "grabando" ? ahora - e.desde : 0)) / 1000);

export const fmtDuracion = (s: number) => {
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// ---------------------------------------------------------------------------
// Guardado en el teléfono (IndexedDB)
// ---------------------------------------------------------------------------

type Sesion = { sesion: string; meta: MetaGrabacion; mime: string; inicio: string };
type Trozo = { sesion: string; parte: number; blob: Blob };

let dbProm: Promise<IDBDatabase> | null = null;
function abrirDb(): Promise<IDBDatabase> {
  return (dbProm ??= new Promise((ok, mal) => {
    const req = indexedDB.open("prodi-grabaciones", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("sesiones", { keyPath: "sesion" });
      req.result.createObjectStore("trozos", { autoIncrement: true }).createIndex("sesion", "sesion");
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => {
      dbProm = null;
      mal(req.error);
    };
  }));
}

async function tx<T>(stores: string[], modo: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await abrirDb();
  return new Promise((ok, mal) => {
    const t = db.transaction(stores, modo);
    const r = fn(t);
    t.oncomplete = () => ok(r ? r.result : undefined);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error);
  });
}

const guardarSesion = (s: Sesion) => tx(["sesiones"], "readwrite", (t) => void t.objectStore("sesiones").put(s)).catch(() => undefined);
const guardarTrozo = (z: Trozo) => tx(["trozos"], "readwrite", (t) => void t.objectStore("trozos").add(z)).catch(() => undefined);

async function trozosDe(sesion: string): Promise<Trozo[]> {
  const r = await tx<Trozo[]>(["trozos"], "readonly", (t) => t.objectStore("trozos").index("sesion").getAll(sesion)).catch(() => undefined);
  return r ?? [];
}

export async function borrarSesion(sesion: string) {
  await tx(["sesiones", "trozos"], "readwrite", (t) => {
    t.objectStore("sesiones").delete(sesion);
    const idx = t.objectStore("trozos").index("sesion");
    const cur = idx.openKeyCursor(IDBKeyRange.only(sesion));
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      t.objectStore("trozos").delete(c.primaryKey);
      c.continue();
    };
  }).catch(() => undefined);
}

/** Grabaciones que quedaron sin subir (el navegador se cerró, se cortó la subida…). */
export async function grabacionesPendientes(): Promise<(Sesion & { bytes: number })[]> {
  if (typeof indexedDB === "undefined") return [];
  const sesiones = (await tx<Sesion[]>(["sesiones"], "readonly", (t) => t.objectStore("sesiones").getAll()).catch(() => undefined)) ?? [];
  const out = [];
  for (const s of sesiones) {
    if (s.sesion === sesionActual) continue;
    const bytes = (await trozosDe(s.sesion)).reduce((n, z) => n + z.blob.size, 0);
    if (bytes > 0) out.push({ ...s, bytes });
    else await borrarSesion(s.sesion);
  }
  return out;
}

const extension = (mime: string) => (mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("aac") ? "m4a" : "webm");

/** Los archivos de una sesión, una por parte: reunion-AAAA-MM-DD-s<sesion>-p<n>.ext */
export async function archivosDeSesion(sesion: string): Promise<File[]> {
  const db = (await tx<Sesion>(["sesiones"], "readonly", (t) => t.objectStore("sesiones").get(sesion)).catch(() => undefined)) ?? null;
  const mime = db?.mime || "audio/webm";
  const dia = (db?.inicio ?? new Date().toISOString()).slice(0, 10);
  const partes = new Map<number, Blob[]>();
  for (const z of await trozosDe(sesion)) partes.set(z.parte, [...(partes.get(z.parte) ?? []), z.blob]);
  return [...partes.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, blobs]) => new File(blobs, `reunion-${dia}-s${sesion}-p${n}.${extension(mime)}`, { type: mime.split(";")[0] }));
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

let sesionActual: string | null = null;
let rec: MediaRecorder | null = null;
let streams: MediaStream[] = [];
let ctx: AudioContext | null = null;
let raf = 0;
let wakeLock: { release: () => Promise<void> } | null = null;
let alTerminarTramo: (() => void) | null = null;

function elegirMime(): string {
  const opciones = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
  for (const m of opciones) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

async function pedirPantallaPrendida() {
  // En Android se puede bloquear tranquilo; en iPhone/iPad se mantiene prendida para que iOS no corte el micrófono.
  if (plataforma() !== "iphone" || wakeLock) return;
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wakeLock = (await wl?.request("screen")) ?? null;
  } catch {
    wakeLock = null;
  }
}

function soltarTodo() {
  cancelAnimationFrame(raf);
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
  void ctx?.close().catch(() => undefined);
  ctx = null;
}

/** Abre el micrófono (y la pestaña de la llamada) y arranca un tramo nuevo de grabación. */
async function abrirTramo(modo: ModoGrabacion) {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  streams.push(mic);
  const ac = new AudioContext();
  ctx = ac;
  void ac.resume().catch(() => undefined);
  let stream: MediaStream = mic;
  if (modo === "llamada") {
    const pantalla = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    streams.push(pantalla);
    const destino = ac.createMediaStreamDestination();
    ac.createMediaStreamSource(mic).connect(destino);
    if (pantalla.getAudioTracks().length) ac.createMediaStreamSource(new MediaStream(pantalla.getAudioTracks())).connect(destino);
    // Si dejan de compartir la pestaña, se termina.
    pantalla.getVideoTracks()[0]?.addEventListener("ended", () => void terminarGrabacion());
    stream = destino.stream;
  }

  // Barras de volumen.
  const analizador = ac.createAnalyser();
  analizador.fftSize = 512;
  ac.createMediaStreamSource(stream).connect(analizador);
  const datos = new Uint8Array(analizador.fftSize);
  let ultimo = 0;
  const medir = (t: number) => {
    raf = requestAnimationFrame(medir);
    if (t - ultimo < 90) return;
    ultimo = t;
    analizador.getByteTimeDomainData(datos);
    let suma = 0;
    for (const v of datos) suma += ((v - 128) / 128) ** 2;
    const nivel = estado.fase === "grabando" ? Math.min(1, Math.sqrt(suma / datos.length) * 4) : 0;
    cambiar({ niveles: [...estado.niveles.slice(1), nivel] });
  };
  raf = requestAnimationFrame(medir);

  // Si el sistema corta el micrófono (iPhone al bloquear, otra app que lo toma), se cierra la parte y se sigue al volver.
  const pista = mic.getAudioTracks()[0];
  pista?.addEventListener("ended", () => estado.fase === "grabando" && cortarTramo());

  const mime = elegirMime();
  const r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
  const parte = estado.parte;
  const sesion = sesionActual!;
  r.ondataavailable = (e) => {
    if (e.data.size) void guardarTrozo({ sesion, parte, blob: e.data });
  };
  r.onstop = () => {
    const fin = alTerminarTramo;
    alTerminarTramo = null;
    // El último pedazo llega justo antes de onstop: se le da un instante para que se guarde.
    window.setTimeout(() => fin?.(), 300);
  };
  r.start(4000);
  rec = r;
  return r.mimeType || mime || "audio/webm";
}

function pararTramo(): Promise<void> {
  return new Promise((ok) => {
    if (!rec || rec.state === "inactive") {
      soltarTodo();
      return ok();
    }
    alTerminarTramo = ok;
    rec.stop();
    rec = null;
    soltarTodo();
  });
}

function cortarTramo() {
  if (estado.fase !== "grabando") return;
  cambiar({ fase: "cortada", acumulado: estado.acumulado + (Date.now() - estado.desde) });
  void pararTramo();
}

/** Al volver a la app después de un corte, sigue sola en la parte siguiente. */
async function seguirDespuesDelCorte() {
  if (estado.fase !== "cortada" || !estado.meta) return;
  try {
    cambiar({ parte: estado.parte + 1 });
    await abrirTramo(estado.modo);
    await pedirPantallaPrendida();
    cambiar({ fase: "grabando", desde: Date.now() });
  } catch {
    // Sin permiso o sin micrófono: queda cortada y se puede terminar igual con lo grabado.
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (estado.fase === "cortada") void seguirDespuesDelCorte();
    // iOS suelta la pantalla prendida al salir: se vuelve a pedir.
    if (estado.fase === "grabando") {
      wakeLock = null;
      void pedirPantallaPrendida();
      // Si el micrófono murió mientras no se veía, se corta y se sigue.
      const vivo = streams[0]?.getAudioTracks()[0]?.readyState === "live";
      if (!vivo) {
        cortarTramo();
        void seguirDespuesDelCorte();
      }
    }
  });
}

export async function empezarGrabacion(meta: MetaGrabacion, modo: ModoGrabacion) {
  if (estado.fase !== "inactiva") throw new Error("Ya hay una grabación en curso. Terminala primero.");
  sesionActual = Math.random().toString(36).slice(2, 8);
  cambiar({ ...INICIAL, meta, modo, parte: 1 });
  try {
    const mime = await abrirTramo(modo);
    await guardarSesion({ sesion: sesionActual, meta, mime, inicio: new Date().toISOString() });
    await pedirPantallaPrendida();
    cambiar({ fase: "grabando", desde: Date.now() });
  } catch (err) {
    soltarTodo();
    sesionActual = null;
    cambiar(INICIAL);
    throw err;
  }
}

export function pausarGrabacion() {
  if (estado.fase !== "grabando" || !rec) return;
  rec.pause();
  cambiar({ fase: "pausada", acumulado: estado.acumulado + (Date.now() - estado.desde) });
}

export async function reanudarGrabacion() {
  if (estado.fase === "cortada") return seguirDespuesDelCorte();
  if (estado.fase !== "pausada" || !rec) return;
  rec.resume();
  cambiar({ fase: "grabando", desde: Date.now() });
}

/** Termina y devuelve la sesión para subirla (los archivos quedan en el teléfono hasta que se suban bien). */
export async function terminarGrabacion(): Promise<{ sesion: string; meta: MetaGrabacion; segundos: number } | null> {
  if (estado.fase === "inactiva" || !sesionActual || !estado.meta) return null;
  const segundos = segundosGrabados(estado);
  const sesion = sesionActual;
  const meta = estado.meta;
  await pararTramo();
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  sesionActual = null;
  cambiar(INICIAL);
  return { sesion, meta, segundos };
}

/** Descarta la grabación en curso sin guardar nada. */
export async function descartarGrabacion() {
  const sesion = sesionActual;
  await pararTramo();
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  sesionActual = null;
  cambiar(INICIAL);
  if (sesion) await borrarSesion(sesion);
}
