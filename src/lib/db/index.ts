/* eslint-disable @typescript-eslint/no-explicit-any */
// Datos de la app en Postgres a través de /api/db (reemplaza a Firestore en el navegador).
//
// Mantiene los mismos nombres que usaba la app (collection, doc, query, where, onSnapshot,
// addDoc, updateDoc…), así el resto del código no cambia. "En vivo": cada pocos segundos
// pregunta qué colecciones cambiaron y vuelve a pedir solo lo que hace falta.

import { auth, sesionVencida } from "@/lib/auth";
import { autoria } from "@/lib/redes/vistaComo";
import { guardarCopia, leerCopia } from "./cache";

export type DocumentData = Record<string, any>;

export interface ColRef {
  type: "collection";
  path: string;
}
export interface DocRef {
  type: "doc";
  path: string;
  id: string;
  col: string;
}
export interface QueryConstraint {
  kind: "where" | "orderBy" | "limit";
  field?: string;
  op?: string;
  value?: any;
  n?: number;
}
export interface Query {
  type: "query";
  path: string;
  constraints: QueryConstraint[];
}
export type DocumentReference = DocRef;
export type CollectionReference = ColRef;

/** Marcador de la base (para la firma de `collection(db, …)`). */
export const db = { tipo: "prodi-db" } as const;

const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function nuevoId(): string {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  let s = "";
  for (let i = 0; i < 20; i++) s += ABC[b[i] % ABC.length];
  return s;
}

const juntar = (segs: string[]) => segs.join("/").split("/").filter(Boolean);

export function collection(base: any, ...segs: string[]): ColRef {
  const prefijo = base?.type === "doc" ? [base.path] : [];
  return { type: "collection", path: juntar([...prefijo, ...segs]).join("/") };
}

export function doc(base: any, ...segs: string[]): DocRef {
  if (base?.type === "collection") {
    const id = segs.length ? juntar(segs).join("/") : nuevoId();
    return { type: "doc", path: `${base.path}/${id}`, id, col: base.path };
  }
  const partes = juntar(segs);
  const id = partes[partes.length - 1];
  const col = partes.slice(0, -1).join("/");
  return { type: "doc", path: `${col}/${id}`, id, col };
}

export function query(ref: ColRef | Query, ...constraints: QueryConstraint[]): Query {
  const prev = ref.type === "query" ? ref.constraints : [];
  return { type: "query", path: ref.path, constraints: [...prev, ...constraints] };
}
export const documentId = () => "__name__";
export const where = (field: string, op: string, value: any): QueryConstraint => ({ kind: "where", field, op, value });
export const orderBy = (field: string, dir: "asc" | "desc" = "asc"): QueryConstraint => ({ kind: "orderBy", field, value: dir });
export const limit = (n: number): QueryConstraint => ({ kind: "limit", n });

// Valores especiales (el servidor los resuelve)
export const arrayUnion = (...v: any[]) => ({ __op: "union", v });
export const arrayRemove = (...v: any[]) => ({ __op: "remove", v });
export const increment = (n: number) => ({ __op: "inc", n });
export const deleteField = () => ({ __op: "del" });
export const serverTimestamp = () => ({ __op: "now" });

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

const clonar = <T,>(v: T): T => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));

export interface DocumentSnapshot {
  id: string;
  ref: DocRef;
  exists: () => boolean;
  data: () => DocumentData | undefined;
  get: (campo: string) => any;
}
export interface QuerySnapshot {
  docs: DocumentSnapshot[];
  empty: boolean;
  size: number;
  forEach: (fn: (d: DocumentSnapshot) => void) => void;
}

function snapDoc(col: string, id: string, data: DocumentData | null): DocumentSnapshot {
  return {
    id,
    ref: { type: "doc", path: `${col}/${id}`, id, col },
    exists: () => data !== null,
    data: () => (data === null ? undefined : clonar(data)),
    get: (campo: string) => campo.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), data ?? undefined),
  };
}
function snapQuery(col: string, docs: { id: string; data: DocumentData }[]): QuerySnapshot {
  const ds = docs.map((d) => snapDoc(col, d.id, d.data));
  return { docs: ds, empty: ds.length === 0, size: ds.length, forEach: (fn) => ds.forEach(fn) };
}

// ---------------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------------

class DbError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

async function api<T>(accion: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new DbError("unauthenticated", "Sesión vencida. Volvé a ingresar.");
  const token = await user.getIdToken();
  const res = await fetch(`/api/db/${accion}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* vacío */
  }
  if (res.status === 401) sesionVencida();
  if (!res.ok) {
    const code = res.status === 403 ? "permission-denied" : res.status === 409 ? "failed-precondition" : res.status === 401 ? "unauthenticated" : "unknown";
    throw new DbError(code, data?.error ?? `Error ${res.status}`);
  }
  return data as T;
}

type Spec = { ruta: string } | { coleccion: string; filtros: unknown[]; orden: unknown[]; limite: number | null };

function specDe(t: DocRef | ColRef | Query): Spec {
  if (t.type === "doc") return { ruta: t.path };
  const cs = t.type === "query" ? t.constraints : [];
  return {
    coleccion: t.path,
    filtros: cs.filter((c) => c.kind === "where").map((c) => ({ campo: c.field, op: c.op, valor: c.value })),
    orden: cs.filter((c) => c.kind === "orderBy").map((c) => ({ campo: c.field, dir: c.value })),
    limite: cs.find((c) => c.kind === "limit")?.n ?? null,
  };
}
const coleccionDe = (t: DocRef | ColRef | Query) => (t.type === "doc" ? t.col : t.path);

/** "chats/abc/mensajes" → "chats/*\/mensajes" (así avisa el servidor los cambios). */
const patron = (col: string) => {
  const s = col.split("/");
  return s.length === 3 ? `${s[0]}/*/${s[2]}` : s[0];
};

// Junta todas las consultas de un mismo momento en un solo pedido.
type Resultado = {
  doc?: { id: string; data: DocumentData } | null;
  docs?: { id: string; data: DocumentData }[];
  error?: string;
  /** Marca para pedir solo lo nuevo la próxima vez. */
  rev?: number;
  /** Respuesta con solo lo cambiado: `docs` se agregan o reemplazan y `quitar` se sacan. */
  parcial?: boolean;
  quitar?: string[];
};
let cola: { spec: Spec & { desde?: number }; resolver: (r: Resultado) => void; fallar: (e: unknown) => void }[] = [];
let colaProgramada = false;
function consultar(spec: Spec, desde?: number): Promise<Resultado> {
  return new Promise((resolver, fallar) => {
    cola.push({ spec: desde ? { ...spec, desde } : spec, resolver, fallar });
    if (colaProgramada) return;
    colaProgramada = true;
    setTimeout(async () => {
      const lote = cola;
      cola = [];
      colaProgramada = false;
      for (let i = 0; i < lote.length; i += 40) {
        const parte = lote.slice(i, i + 40);
        try {
          const r = await api<{ resultados: Resultado[] }>("consultar", { consultas: parte.map((x) => x.spec) });
          parte.forEach((x, j) => x.resolver(r.resultados[j] ?? { error: "Sin respuesta" }));
        } catch (err) {
          parte.forEach((x) => x.fallar(err));
        }
      }
    }, 8);
  });
}

function aSnapshot(t: DocRef | ColRef | Query, r: Resultado): DocumentSnapshot | QuerySnapshot {
  if (r.error) throw new DbError(r.error === "permission-denied" ? "permission-denied" : "unknown", r.error);
  if (t.type === "doc") return snapDoc(t.col, t.id, r.doc ? r.doc.data : null);
  return snapQuery(t.path, r.docs ?? []);
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export async function getDoc(ref: DocRef): Promise<DocumentSnapshot> {
  return aSnapshot(ref, await consultar(specDe(ref))) as DocumentSnapshot;
}
export async function getDocs(q: ColRef | Query): Promise<QuerySnapshot> {
  return aSnapshot(q, await consultar(specDe(q))) as QuerySnapshot;
}

// ---------------------------------------------------------------------------
// En vivo
// ---------------------------------------------------------------------------

interface Suscripcion {
  target: DocRef | ColRef | Query;
  spec: Spec;
  col: string;
  oyentes: Set<{ cb: (s: any) => void; err?: (e: unknown) => void }>;
  ultimo?: string;
  snap?: any;
  pidiendo?: boolean;
  repetir?: boolean;
  /** Colecciones sin límite: lo que ya se tiene (para pedir solo lo nuevo) y la marca de la base. */
  docs?: Map<string, DocumentData>;
  rev?: number;
  /** Cuándo se bajó todo completo por última vez (ms). */
  completo?: number;
  /** Clave de la copia local (por usuario y consulta). */
  copia?: string;
}
const subs = new Map<string, Suscripcion>();

/** Cada cuánto se baja todo completo igual (por si cambió algún permiso sin que cambien los datos). */
const COMPLETO_CADA = 6 * 3600_000;

/** Se puede pedir solo lo nuevo: consulta de colección sin límite (las con límite son chicas). */
const incremental = (spec: Spec) => "coleccion" in spec && !spec.limite;

/** Orden de la consulta, aplicado en la pantalla al juntar lo nuevo con lo que ya había. */
function ordenar(lista: { id: string; data: DocumentData }[], spec: Spec) {
  const orden = "coleccion" in spec ? (spec.orden as { campo: string; dir: "asc" | "desc" }[]) : [];
  if (!orden.length) return lista;
  const valor = (d: DocumentData, campo: string) => campo.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), d);
  return [...lista].sort((a, b) => {
    for (const o of orden) {
      const x = valor(a.data, o.campo);
      const y = valor(b.data, o.campo);
      if (x === y) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = x < y ? -1 : 1;
      return o.dir === "desc" ? -c : c;
    }
    return 0;
  });
}

function emitir(s: Suscripcion, r: Resultado) {
  try {
    s.snap = aSnapshot(s.target, r);
    s.oyentes.forEach((o) => o.cb(s.snap));
  } catch (err) {
    s.snap = undefined;
    s.oyentes.forEach((o) => o.err?.(err));
  }
}

function guardar(s: Suscripcion) {
  if (!s.copia || !s.docs || !s.rev) return;
  const docs = s.docs;
  const rev = s.rev;
  const completo = s.completo ?? Date.now();
  guardarCopia(s.copia, () => ({ rev, completo, docs: [...docs.entries()] }));
}

async function refrescar(s: Suscripcion, forzarCompleto = false) {
  if (s.pidiendo) {
    s.repetir = true;
    return;
  }
  s.pidiendo = true;
  try {
    const parcialPosible =
      !forzarCompleto && incremental(s.spec) && !!s.docs && !!s.rev && Date.now() - (s.completo ?? 0) < COMPLETO_CADA;
    const r = await consultar(s.spec, parcialPosible ? s.rev : undefined);
    if (r.error) {
      emitir(s, r);
      return;
    }
    if (r.parcial && s.docs) {
      // Solo lo que cambió: se junta con lo que ya había (sin volver a bajar todo).
      if (r.rev) s.rev = r.rev;
      if (!r.docs?.length && !r.quitar?.length) return;
      for (const id of r.quitar ?? []) s.docs.delete(id);
      for (const d of r.docs ?? []) s.docs.set(d.id, d.data);
      const lista = ordenar([...s.docs.entries()].map(([id, data]) => ({ id, data })), s.spec);
      s.ultimo = undefined;
      emitir(s, { docs: lista });
      guardar(s);
      return;
    }
    if (incremental(s.spec) && r.docs) {
      s.docs = new Map(r.docs.map((d) => [d.id, d.data]));
      s.rev = r.rev;
      s.completo = Date.now();
      guardar(s);
    }
    // Solo los datos (la marca cambia siempre): si no cambió nada, no se vuelve a dibujar.
    const firma = JSON.stringify(r.docs ?? r.doc ?? null);
    if (firma !== s.ultimo) {
      s.ultimo = firma;
      emitir(s, r);
    }
  } catch (err) {
    s.oyentes.forEach((o) => o.err?.(err));
  } finally {
    s.pidiendo = false;
    if (s.repetir) {
      s.repetir = false;
      void refrescar(s);
    }
  }
}

/** Vuelve a pedir lo que se está mirando de esas colecciones. */
function refrescarColecciones(patrones: Iterable<string>) {
  const set = new Set(patrones);
  subs.forEach((s) => {
    if (set.has(patron(s.col))) void refrescar(s);
  });
}

// Cada 4 s (cada 60 s con la pestaña en segundo plano) pregunta qué cambió. Con la app escondida más de
// 15 min deja de preguntar hasta que se vuelva a mirar (no gasta tráfico de la base sin que nadie mire).
let rev: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let ocultaDesde: number | null = null;
const PAUSA_OCULTA = 15 * 60_000;
async function sondear() {
  timer = null;
  if (!subs.size || !auth.currentUser) return;
  if (ocultaDesde && Date.now() - ocultaDesde > PAUSA_OCULTA) return;
  try {
    const r = await api<{ rev: number; colecciones: string[] }>("cambios", { desde: rev });
    const primera = rev === null;
    rev = r.rev;
    if (!primera && r.colecciones.length) refrescarColecciones(r.colecciones);
  } catch {
    /* sin conexión: se reintenta */
  }
  programar();
}
function programar(ms?: number) {
  if (timer || !subs.size) return;
  const oculto = typeof document !== "undefined" && document.visibilityState === "hidden";
  timer = setTimeout(sondear, ms ?? (oculto ? 60_000 : 4_000));
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      ocultaDesde = Date.now();
      return;
    }
    const estuvoPausada = ocultaDesde !== null && Date.now() - ocultaDesde > PAUSA_OCULTA;
    ocultaDesde = null;
    if (!subs.size) return;
    if (timer) clearTimeout(timer);
    timer = null;
    // Si estuvo pausada, se ponen al día las pantallas abiertas (solo lo nuevo).
    if (estuvoPausada) subs.forEach((s) => void refrescar(s));
    programar(50);
  });
}

export function onSnapshot(target: any, cb: (s: any) => void, err?: (e: unknown) => void): () => void {
  const spec = specDe(target);
  const clave = JSON.stringify(spec);
  let s = subs.get(clave);
  const oyente = { cb, err };
  if (!s) {
    const nueva: Suscripcion = { target, spec, col: coleccionDe(target), oyentes: new Set() };
    s = nueva;
    subs.set(clave, nueva);
    nueva.oyentes.add(oyente);
    const uid = auth.currentUser?.uid;
    if (incremental(spec) && uid) {
      // Primero lo guardado en el dispositivo (se ve al toque) y después solo lo nuevo.
      nueva.copia = `${uid}|${clave}`;
      void leerCopia(nueva.copia).then((c) => {
        if (c && !nueva.docs && Date.now() - c.completo < COMPLETO_CADA) {
          nueva.docs = new Map(c.docs);
          nueva.rev = c.rev;
          nueva.completo = c.completo;
          emitir(nueva, { docs: ordenar(c.docs.map(([id, data]) => ({ id, data })), spec) });
        }
        void refrescar(nueva);
      });
    } else {
      void refrescar(nueva);
    }
    if (rev === null) programar(50);
    else programar();
  } else {
    s.oyentes.add(oyente);
    const snap = s.snap;
    if (snap) setTimeout(() => s!.oyentes.has(oyente) && cb(snap), 0);
  }
  const sub = s;
  return () => {
    sub.oyentes.delete(oyente);
    if (!sub.oyentes.size) subs.delete(clave);
  };
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

type Op = { tipo: "set" | "update" | "create" | "delete"; ruta: string; data?: DocumentData; merge?: boolean };

async function escribir(ops: Op[]) {
  if (!ops.length) return;
  // En "ver como" con cambios permitidos, lo escrito queda a nombre del super admin.
  await api("escribir", { ops: ops.map((o) => (o.data ? { ...o, data: autoria(o.data) } : o)) });
  refrescarColecciones(ops.map((o) => patron(o.ruta.split("/").slice(0, -1).join("/"))));
}

export async function addDoc(ref: ColRef, data: DocumentData): Promise<DocRef> {
  const d = doc(ref);
  await escribir([{ tipo: "create", ruta: d.path, data }]);
  return d;
}
export async function setDoc(ref: DocRef, data: DocumentData, opts?: { merge?: boolean }) {
  await escribir([{ tipo: "set", ruta: ref.path, data, merge: !!opts?.merge }]);
}
export async function updateDoc(ref: DocRef, data: DocumentData) {
  await escribir([{ tipo: "update", ruta: ref.path, data }]);
}
export async function deleteDoc(ref: DocRef) {
  await escribir([{ tipo: "delete", ruta: ref.path }]);
}

export function writeBatch(_db?: unknown) {
  const ops: Op[] = [];
  const lote = {
    set: (ref: DocRef, data: DocumentData, opts?: { merge?: boolean }) => (ops.push({ tipo: "set", ruta: ref.path, data, merge: !!opts?.merge }), lote),
    update: (ref: DocRef, data: DocumentData) => (ops.push({ tipo: "update", ruta: ref.path, data }), lote),
    delete: (ref: DocRef) => (ops.push({ tipo: "delete", ruta: ref.path }), lote),
    commit: () => escribir(ops),
  };
  return lote;
}

// Compatibilidad con la inicialización anterior.
export const getFirestore = () => db;
export const initializeFirestore = () => db;
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
