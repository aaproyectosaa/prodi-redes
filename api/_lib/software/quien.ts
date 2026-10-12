// Quién hizo el pedido que está corriendo (para que Actividad diga "Pato registró un pago", no "prodi").
// El despachador (api/software/[accion].ts) lo fija antes de correr cada acción.

import { AsyncLocalStorage } from "node:async_hooks";

export type Quien = { nombre: string; uid?: string };

const actual = new AsyncLocalStorage<Quien>();

export function conQuien<T>(q: Quien, fn: () => Promise<T>): Promise<T> {
  return actual.run(q, fn);
}

export function quienEs(): Quien | undefined {
  return actual.getStore();
}
