/* eslint-disable @typescript-eslint/no-explicit-any */
// Reglas de escritura de documentos (las mismas en el servidor y en la API de la app):
// set (reemplaza o mezcla), update con rutas "a.b.c" y los valores especiales
// (sumar a una lista, quitar, incrementar, borrar un campo).

import { randomBytes } from "crypto";

export type Data = Record<string, any>;

export type Especial =
  | { __op: "union"; v: unknown[] }
  | { __op: "remove"; v: unknown[] }
  | { __op: "inc"; n: number }
  | { __op: "del" }
  | { __op: "now" };

export const FieldValue = {
  arrayUnion: (...v: unknown[]): Especial => ({ __op: "union", v }),
  arrayRemove: (...v: unknown[]): Especial => ({ __op: "remove", v }),
  increment: (n: number): Especial => ({ __op: "inc", n }),
  delete: (): Especial => ({ __op: "del" }),
  serverTimestamp: (): Especial => ({ __op: "now" }),
};

const OPS = new Set(["union", "remove", "inc", "del", "now"]);
export const esEspecial = (v: unknown): v is Especial =>
  !!v && typeof v === "object" && !Array.isArray(v) && OPS.has((v as { __op?: string }).__op ?? "");

const esObjeto = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v) && !esEspecial(v);

export const clonar = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Aplica un valor (normal o especial) sobre el actual. `undefined` = borrar el campo. */
export function aplicarValor(actual: unknown, valor: unknown): unknown {
  if (esEspecial(valor)) {
    switch (valor.__op) {
      case "union": {
        const arr = Array.isArray(actual) ? [...actual] : [];
        for (const x of valor.v) if (!arr.some((y) => igual(y, x))) arr.push(clonar(x));
        return arr;
      }
      case "remove":
        return (Array.isArray(actual) ? actual : []).filter((y) => !valor.v.some((x) => igual(x, y)));
      case "inc":
        return (typeof actual === "number" ? actual : 0) + Number(valor.n || 0);
      case "del":
        return undefined;
      case "now":
        return new Date().toISOString();
    }
  }
  return limpiar(valor);
}

/** Resuelve los especiales que vengan adentro de un objeto nuevo (y saca los undefined). */
function limpiar(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (esEspecial(v)) return aplicarValor(undefined, v);
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : limpiar(x)));
  if (v && typeof v === "object") {
    const out: Data = {};
    for (const [k, x] of Object.entries(v)) {
      const r = limpiar(x);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return v;
}

export function leerRuta(obj: Data | undefined, ruta: string): unknown {
  return ruta.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Escribe en una ruta "a.b.c" creando los mapas intermedios. */
export function escribirRuta(obj: Data, ruta: string, valor: unknown) {
  const keys = ruta.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!esObjeto(o[k])) o[k] = {};
    o = o[k];
  }
  const ultima = keys[keys.length - 1];
  const nuevo = aplicarValor(o[ultima], valor);
  if (nuevo === undefined) delete o[ultima];
  else o[ultima] = nuevo;
}

/** update(): cada clave es una ruta. El documento tiene que existir. */
export function aplicarUpdate(actual: Data, patch: Data): Data {
  const out = clonar(actual);
  for (const [k, v] of Object.entries(patch)) escribirRuta(out, k, v);
  return out;
}

/** set() con merge: mezcla mapas en profundidad (las listas se reemplazan). */
function mezclar(destino: Data, origen: Data) {
  for (const [k, v] of Object.entries(origen)) {
    if (esObjeto(v) && esObjeto(destino[k])) mezclar(destino[k], v);
    else {
      const nuevo = aplicarValor(destino[k], v);
      if (nuevo === undefined) delete destino[k];
      else destino[k] = nuevo;
    }
  }
}

export function aplicarSet(actual: Data | null, data: Data, merge: boolean): Data {
  if (merge && actual) {
    const out = clonar(actual);
    mezclar(out, data);
    return out;
  }
  return (limpiar(data) as Data) ?? {};
}

/** Claves de primer nivel que cambiaron (para las reglas "solo puede cambiar X"). */
export function clavesCambiadas(antes: Data | null, despues: Data | null): string[] {
  const a = antes ?? {};
  const b = despues ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !igual(a[k], b[k]));
}

/** Id al azar estilo Firestore (20 caracteres). */
export function nuevoId(): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const bytes = randomBytes(20);
  for (let i = 0; i < 20; i++) s += abc[bytes[i] % abc.length];
  return s;
}
