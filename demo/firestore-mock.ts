/* eslint-disable @typescript-eslint/no-explicit-any */
/* Firestore en memoria para la demo navegable. Implementa solo lo que usa la app. */
import { seed } from "./seed";

type Data = Record<string, any>;
const KEY = "prodi-demo-db-v11";

const store: Record<string, Record<string, Data>> = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* sin storage */
  }
  return seed();
}
let saveTimer: number | undefined;
function persist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      /* ignore */
    }
  }, 150);
}
export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const rid = () => Math.random().toString(36).slice(2, 12);

export interface ColRef { type: "collection"; col: string }
export interface DocRef { type: "doc"; col: string; id: string; path: string }
export interface Constraint { kind: "where" | "limit" | "orderBy"; field?: string; op?: string; value?: any; n?: number }
export interface Query { type: "query"; col: string; constraints: Constraint[] }

export const db = {};
export const serverTimestamp = () => new Date().toISOString();
export type QueryConstraint = Constraint;
export type DocumentData = Record<string, any>;
export const initializeFirestore = () => ({});
export const getFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});

export function collection(_db: unknown, ...path: string[]): ColRef {
  return { type: "collection", col: path.join("/") };
}
export function doc(base: any, ...segs: string[]): DocRef {
  if (base?.type === "collection") {
    const id = segs[0] ?? rid();
    return { type: "doc", col: base.col, id, path: `${base.col}/${id}` };
  }
  const parts = segs.join("/").split("/");
  const id = parts.pop()!;
  const col = parts.join("/");
  return { type: "doc", col, id, path: `${col}/${id}` };
}
export function query(ref: ColRef, ...constraints: Constraint[]): Query {
  return { type: "query", col: ref.col, constraints };
}
export const documentId = () => "__name__";
export const where = (field: string, op: string, value: any): Constraint => ({ kind: "where", field, op, value });
export const limit = (n: number): Constraint => ({ kind: "limit", n });
export const orderBy = (field: string, dir: "asc" | "desc" = "asc"): Constraint => ({ kind: "orderBy", field, value: dir });

function getField(obj: Data, path: string) {
  return path.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), obj);
}
function matches(d: Data, c: Constraint, id?: string) {
  if (c.kind !== "where") return true;
  const v = c.field === "__name__" ? id : getField(d, c.field!);
  switch (c.op) {
    case "==": return v === c.value;
    case "!=": return v !== c.value && v !== undefined;
    case "in": return (c.value as any[]).includes(v);
    case "array-contains": return Array.isArray(v) && v.includes(c.value);
    case ">=": return v !== undefined && v >= c.value;
    case "<=": return v !== undefined && v <= c.value;
    case ">": return v !== undefined && v > c.value;
    case "<": return v !== undefined && v < c.value;
    default: return true;
  }
}

function docSnap(col: string, id: string) {
  const data = store[col]?.[id];
  return {
    id,
    ref: { type: "doc", col, id, path: `${col}/${id}` } as DocRef,
    exists: () => data !== undefined,
    data: () => clone(data),
  };
}
function querySnap(q: ColRef | Query) {
  const constraints = q.type === "query" ? q.constraints : [];
  let ids = Object.keys(store[q.col] ?? {}).filter((id) => constraints.every((c) => matches(store[q.col][id], c, id)));
  const ord = constraints.find((c) => c.kind === "orderBy");
  if (ord) {
    ids.sort((a, b) => {
      const va = getField(store[q.col][a], ord.field!) ?? "";
      const vb = getField(store[q.col][b], ord.field!) ?? "";
      return (va < vb ? -1 : va > vb ? 1 : 0) * (ord.value === "desc" ? -1 : 1);
    });
  }
  const lim = constraints.find((c) => c.kind === "limit");
  if (lim) ids = ids.slice(0, lim.n);
  const docs = ids.map((id) => docSnap(q.col, id));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn: (d: any) => void) => docs.forEach(fn) };
}

type Listener = { target: DocRef | ColRef | Query; cb: (s: any) => void };
const listeners = new Set<Listener>();
let notifyQueued = false;
function notify() {
  persist();
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    listeners.forEach((l) => fire(l));
  });
}
function fire(l: Listener) {
  const t = l.target;
  l.cb(t.type === "doc" ? docSnap(t.col, t.id) : querySnap(t));
}

export function onSnapshot(target: any, cb: (s: any) => void, _err?: (e: unknown) => void) {
  const l = { target, cb };
  listeners.add(l);
  setTimeout(() => listeners.has(l) && fire(l), 30);
  return () => listeners.delete(l);
}
export async function getDoc(ref: DocRef) {
  return docSnap(ref.col, ref.id);
}
export async function getDocs(q: ColRef | Query) {
  return querySnap(q);
}

// Sentinels
export const arrayUnion = (...v: any[]) => ({ __op: "union", v });
export const arrayRemove = (...v: any[]) => ({ __op: "remove", v });
export const increment = (n: number) => ({ __op: "inc", n });
export const deleteField = () => ({ __op: "del" });

function applyValue(cur: any, val: any) {
  if (val && typeof val === "object" && "__op" in val) {
    if (val.__op === "union") {
      const arr = Array.isArray(cur) ? [...cur] : [];
      for (const x of val.v) if (!arr.some((y) => JSON.stringify(y) === JSON.stringify(x))) arr.push(clone(x));
      return arr;
    }
    if (val.__op === "remove") {
      const arr = Array.isArray(cur) ? cur : [];
      return arr.filter((y) => !val.v.some((x: any) => JSON.stringify(x) === JSON.stringify(y)));
    }
    if (val.__op === "inc") return (Number(cur) || 0) + val.n;
    if (val.__op === "del") return undefined;
  }
  return clone(val);
}
function setPath(obj: Data, path: string, val: any) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  const last = keys[keys.length - 1];
  const next = applyValue(o[last], val);
  if (next === undefined) delete o[last];
  else o[last] = next;
}
function rawUpdate(ref: DocRef, patch: Data) {
  const cur = store[ref.col]?.[ref.id];
  if (!cur) throw new Error(`No existe ${ref.path}`);
  for (const [k, v] of Object.entries(patch)) setPath(cur, k, v);
}
function rawSet(ref: DocRef, data: Data, merge?: boolean) {
  store[ref.col] = store[ref.col] ?? {};
  if (merge && store[ref.col][ref.id]) {
    for (const [k, v] of Object.entries(data)) setPath(store[ref.col][ref.id], k, v);
  } else {
    const obj: Data = {};
    for (const [k, v] of Object.entries(data)) setPath(obj, k, v);
    store[ref.col][ref.id] = obj;
  }
}

export async function addDoc(ref: ColRef, data: Data) {
  const d = doc(ref);
  rawSet(d, data);
  notify();
  return d;
}
export async function setDoc(ref: DocRef, data: Data, opts?: { merge?: boolean }) {
  rawSet(ref, data, opts?.merge);
  notify();
}
export async function updateDoc(ref: DocRef, patch: Data) {
  rawUpdate(ref, patch);
  notify();
}
export async function deleteDoc(ref: DocRef) {
  delete store[ref.col]?.[ref.id];
  notify();
}
export function writeBatch() {
  const ops: (() => void)[] = [];
  return {
    set: (r: DocRef, d: Data, o?: { merge?: boolean }) => ops.push(() => rawSet(r, d, o?.merge)),
    update: (r: DocRef, d: Data) => ops.push(() => rawUpdate(r, d)),
    delete: (r: DocRef) => ops.push(() => delete store[r.col]?.[r.id]),
    commit: async () => {
      ops.forEach((f) => f());
      notify();
    },
  };
}

/** Acceso directo para los mocks de /api. */
export const demoStore = {
  get: (col: string, id: string) => clone(store[col]?.[id]),
  all: (col: string) => Object.entries(store[col] ?? {}).map(([id, d]) => ({ id, ...clone(d) })),
};
