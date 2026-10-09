/* eslint-disable @typescript-eslint/no-explicit-any */
// Base de datos de Prodi Redes en Postgres (Neon).
//
// Expone la misma forma de trabajo que usaban las funciones con Firestore:
//   db.collection("videos").doc(id).get() / set() / update() / delete()
//   db.collection("videos").where("proyecto_id", "==", pid).orderBy("mes").limit(10).get()
//   db.runTransaction(async (tx) => { … })   db.batch()   FieldValue.arrayUnion(…)
// Los documentos se guardan como JSON en la tabla `documentos` (ver db/esquema.sql).

import { Pool, type PoolClient } from "pg";
import { aplicarSet, aplicarUpdate, clonar, nuevoId, type Data } from "./docs";

export { FieldValue } from "./docs";
export type { Data } from "./docs";

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (la conexión a Postgres / Neon) en las variables de entorno.");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  pool = new Pool({
    // "sslmode=require" de Neon: pg ya lo trata como verify-full; se pone explícito para no llenar el log de avisos.
    connectionString: local ? url : url.replace(/([?&])sslmode=require\b/, "$1sslmode=verify-full"),
    // Neon exige SSL; en local no hace falta.
    ssl: local ? undefined : { rejectUnauthorized: true },
    // Neon pide channel_binding=require en su link: se usa SCRAM-SHA-256-PLUS.
    enableChannelBinding: /[?&]channel_binding=require/.test(url),
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    // Neon puede tardar unos segundos en despertar: mejor esperar que cortar el pedido.
    connectionTimeoutMillis: 25_000,
  });
  return pool;
}

type Ejecutor = Pick<PoolClient, "query">;

// ---------------------------------------------------------------------------
// Consultas (where / orderBy / limit) → SQL sobre JSON
// ---------------------------------------------------------------------------

export type Operador = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains" | "array-contains-any";
export interface Filtro {
  campo: string;
  op: Operador;
  valor: unknown;
}
export interface Orden {
  campo: string;
  dir: "asc" | "desc";
}
export interface Consulta {
  coleccion: string;
  filtros: Filtro[];
  orden: Orden[];
  limite?: number | null;
  /** Solo los que cambiaron después de esta marca (para refrescar sin volver a bajar todo). */
  desdeRev?: number | null;
}

const ID = "__name__";
const OPERADORES = new Set(["==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains", "array-contains-any"]);

const v_es_escalar = (v: unknown) => v !== null && typeof v !== "object";

function anidado(ruta: string[], valor: unknown): unknown {
  return ruta.reduceRight<unknown>((acc, k) => ({ [k]: acc }), valor);
}

/** Arma el WHERE de una consulta. Todo va por parámetros (nada de texto del usuario en el SQL). */
export function sqlConsulta(c: Consulta, params: unknown[]): string {
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const partes = [`coleccion = ${p(c.coleccion)}`];
  if (c.desdeRev != null && Number.isFinite(c.desdeRev)) partes.push(`rev > ${p(Math.floor(c.desdeRev))}`);
  for (const f of c.filtros) {
    if (!OPERADORES.has(f.op)) throw new Error(`Operador no soportado: ${f.op}`);
    if (f.campo === ID) {
      if (f.op === "==") partes.push(`id = ${p(String(f.valor))}`);
      else if (f.op === "in") partes.push(`id = any(${p((f.valor as unknown[]).map(String))}::text[])`);
      else if (f.op === "!=") partes.push(`id <> ${p(String(f.valor))}`);
      else throw new Error("Filtro por id no soportado");
      continue;
    }
    const ruta = f.campo.split(".");
    const usaCampo = !(f.op === "array-contains" || (f.op === "==" && v_es_escalar(f.valor)));
    const campo = usaCampo ? `(data #> ${p(ruta)}::text[])` : "";
    const v = f.valor;
    switch (f.op) {
      case "==":
        if (v === null) partes.push(`${campo} = 'null'::jsonb`);
        else if (typeof v === "object") partes.push(`${campo} = ${p(JSON.stringify(v))}::jsonb`);
        else partes.push(`data @> ${p(JSON.stringify(anidado(ruta, v)))}::jsonb`);
        break;
      case "!=":
        partes.push(`${campo} is not null and ${campo} <> ${p(JSON.stringify(v))}::jsonb`);
        break;
      case "in":
        partes.push(`${campo} = any(${p((v as unknown[]).map((x) => JSON.stringify(x)))}::jsonb[])`);
        break;
      case "not-in":
        partes.push(`${campo} is not null and not (${campo} = any(${p((v as unknown[]).map((x) => JSON.stringify(x)))}::jsonb[]))`);
        break;
      case "array-contains":
        partes.push(`data @> ${p(JSON.stringify(anidado(ruta, [v])))}::jsonb`);
        break;
      case "array-contains-any":
        partes.push(
          `jsonb_typeof(${campo}) = 'array' and exists (select 1 from jsonb_array_elements(${campo}) e where e = any(${p(
            (v as unknown[]).map((x) => JSON.stringify(x))
          )}::jsonb[]))`
        );
        break;
      default: {
        // < <= > >= : solo entre valores del mismo tipo, como Firestore.
        const op = f.op;
        if (typeof v === "number") partes.push(`jsonb_typeof(${campo}) = 'number' and (${campo})::text::numeric ${op} ${p(v)}`);
        else if (typeof v === "string") partes.push(`jsonb_typeof(${campo}) = 'string' and (data #>> ${p(ruta)}::text[]) collate "C" ${op} ${p(v)}`);
        else if (typeof v === "boolean") partes.push(`jsonb_typeof(${campo}) = 'boolean' and (${campo})::text::boolean ${op} ${p(v)}`);
        else throw new Error("Comparación no soportada");
      }
    }
  }
  for (const o of c.orden) {
    if (o.campo !== ID) partes.push(`(data #> ${p(o.campo.split("."))}::text[]) is not null`);
  }
  return partes.join(" and ");
}

export function sqlOrden(c: Consulta, params: unknown[]): string {
  if (!c.orden.length) return "order by id";
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const partes = c.orden.map((o) => {
    const dir = o.dir === "desc" ? "desc" : "asc";
    if (o.campo === ID) return `id ${dir}`;
    // Strings con orden binario (como Firestore); el resto con el orden de jsonb.
    const ruta = p(o.campo.split("."));
    return `case when jsonb_typeof(data #> ${ruta}::text[]) = 'string' then (data #>> ${ruta}::text[]) end collate "C" ${dir}, (data #> ${ruta}::text[]) ${dir}`;
  });
  return `order by ${partes.join(", ")}, id`;
}

export async function ejecutarConsulta(ex: Ejecutor, c: Consulta, bloquear = false): Promise<{ id: string; data: Data }[]> {
  const params: unknown[] = [];
  const where = sqlConsulta(c, params);
  const orden = sqlOrden(c, params);
  const lim = c.limite && c.limite > 0 ? ` limit ${Math.min(10000, Math.floor(c.limite))}` : "";
  const r = await ex.query(`select id, data from documentos where ${where} ${orden}${lim}${bloquear ? " for update" : ""}`, params);
  return r.rows;
}

// ---------------------------------------------------------------------------
// Lectura y escritura de un documento
// ---------------------------------------------------------------------------

export function partirRuta(ruta: string): { coleccion: string; id: string } {
  const segs = ruta.split("/").filter(Boolean);
  if (segs.length < 2 || segs.length % 2 !== 0) throw new Error(`Ruta de documento inválida: ${ruta}`);
  return { coleccion: segs.slice(0, -1).join("/"), id: segs[segs.length - 1] };
}

export async function leerDoc(ex: Ejecutor, coleccion: string, id: string, bloquear = false): Promise<Data | null> {
  if (bloquear) await ex.query("select pg_advisory_xact_lock(hashtext($1))", [`${coleccion}/${id}`]);
  const r = await ex.query(`select data from documentos where coleccion = $1 and id = $2${bloquear ? " for update" : ""}`, [coleccion, id]);
  return r.rows[0]?.data ?? null;
}

export async function guardarDoc(ex: Ejecutor, coleccion: string, id: string, data: Data) {
  await ex.query(
    `insert into documentos (coleccion, id, data) values ($1, $2, $3::jsonb)
     on conflict (coleccion, id) do update set data = excluded.data`,
    [coleccion, id, JSON.stringify(data)]
  );
}

export async function borrarDoc(ex: Ejecutor, coleccion: string, id: string) {
  await ex.query("delete from documentos where coleccion = $1 and id = $2", [coleccion, id]);
}

export class NoExiste extends Error {
  code = 5;
  constructor(ruta: string) {
    super(`No existe el documento ${ruta}`);
  }
}
export class YaExiste extends Error {
  code = 6;
  constructor(ruta: string) {
    super(`Ya existe el documento ${ruta}`);
  }
}

export type OpEscritura =
  | { tipo: "set"; coleccion: string; id: string; data: Data; merge?: boolean }
  | { tipo: "update"; coleccion: string; id: string; data: Data }
  | { tipo: "create"; coleccion: string; id: string; data: Data }
  | { tipo: "delete"; coleccion: string; id: string };

/** Aplica una escritura sobre lo que hay (lo lee y lo bloquea dentro de la transacción). */
export async function aplicarEscritura(
  ex: Ejecutor,
  op: OpEscritura,
  /** Para la API de la app: revisa el permiso con el antes y el después, antes de guardar. */
  autorizar?: (antes: Data | null, despues: Data | null) => Promise<void>
): Promise<{ antes: Data | null; despues: Data | null }> {
  const antes = await leerDoc(ex, op.coleccion, op.id, true);
  const ruta = `${op.coleccion}/${op.id}`;
  let despues: Data | null;
  if (op.tipo === "delete") despues = null;
  else if (op.tipo === "update") {
    if (!antes) throw new NoExiste(ruta);
    despues = aplicarUpdate(antes, op.data);
  } else if (op.tipo === "create") {
    if (antes) throw new YaExiste(ruta);
    despues = aplicarSet(null, op.data, false);
  } else despues = aplicarSet(antes, op.data, !!op.merge);
  if (autorizar) await autorizar(antes, despues);
  if (despues) await guardarDoc(ex, op.coleccion, op.id, despues);
  else if (antes) await borrarDoc(ex, op.coleccion, op.id);
  return { antes, despues };
}

/** Corre algo dentro de una transacción (BEGIN … COMMIT, con ROLLBACK si falla). */
export async function enTransaccion<T>(fn: (cli: PoolClient) => Promise<T>): Promise<T> {
  const cli = await getPool().connect();
  try {
    await cli.query("begin");
    const r = await fn(cli);
    await cli.query("commit");
    return r;
  } catch (err) {
    await cli.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    cli.release();
  }
}

// ---------------------------------------------------------------------------
// API estilo Firestore para las funciones del servidor
// ---------------------------------------------------------------------------

export class DocSnap {
  constructor(
    public readonly ref: DocRef,
    private readonly _data: Data | null
  ) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this._data !== null;
  }
  data(): Data | undefined {
    return this._data ? clonar(this._data) : undefined;
  }
  get(campo: string) {
    return campo.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), this._data ?? undefined);
  }
}

export class QuerySnap {
  constructor(public readonly docs: DocSnap[]) {}
  get empty() {
    return this.docs.length === 0;
  }
  get size() {
    return this.docs.length;
  }
  forEach(fn: (d: DocSnap) => void) {
    this.docs.forEach(fn);
  }
}

export class DocRef {
  readonly coleccion: string;
  readonly id: string;
  constructor(private readonly db: Db, coleccion: string, id: string) {
    this.coleccion = coleccion;
    this.id = id;
  }
  get path() {
    return `${this.coleccion}/${this.id}`;
  }
  get parent() {
    return new CollectionRef(this.db, this.coleccion);
  }
  collection(sub: string) {
    return new CollectionRef(this.db, `${this.path}/${sub}`);
  }
  async get(): Promise<DocSnap> {
    return new DocSnap(this, await leerDoc(getPool(), this.coleccion, this.id));
  }
  async set(data: Data, opts?: { merge?: boolean }) {
    await enTransaccion((cli) => aplicarEscritura(cli, { tipo: "set", coleccion: this.coleccion, id: this.id, data, merge: opts?.merge }));
  }
  async update(data: Data) {
    await enTransaccion((cli) => aplicarEscritura(cli, { tipo: "update", coleccion: this.coleccion, id: this.id, data }));
  }
  async create(data: Data) {
    await enTransaccion((cli) => aplicarEscritura(cli, { tipo: "create", coleccion: this.coleccion, id: this.id, data }));
  }
  async delete() {
    await borrarDoc(getPool(), this.coleccion, this.id);
  }
}

export class Query {
  constructor(
    protected readonly db: Db,
    readonly consulta: Consulta
  ) {}
  where(campo: string | { __id: true }, op: Operador, valor: unknown): Query {
    const c = typeof campo === "string" ? campo : ID;
    return new Query(this.db, { ...this.consulta, filtros: [...this.consulta.filtros, { campo: c, op, valor }] });
  }
  orderBy(campo: string, dir: "asc" | "desc" = "asc"): Query {
    return new Query(this.db, { ...this.consulta, orden: [...this.consulta.orden, { campo, dir }] });
  }
  limit(n: number): Query {
    return new Query(this.db, { ...this.consulta, limite: n });
  }
  async get(): Promise<QuerySnap> {
    const filas = await ejecutarConsulta(getPool(), this.consulta);
    return new QuerySnap(filas.map((f) => new DocSnap(new DocRef(this.db, this.consulta.coleccion, f.id), f.data)));
  }
}

export class CollectionRef extends Query {
  constructor(db: Db, readonly path: string) {
    super(db, { coleccion: path, filtros: [], orden: [], limite: null });
  }
  get id() {
    return this.path.split("/").pop()!;
  }
  doc(id?: string): DocRef {
    return new DocRef(this.db, this.path, id ?? nuevoId());
  }
  async add(data: Data): Promise<DocRef> {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
}

class Transaccion {
  private pendientes: OpEscritura[] = [];
  constructor(private readonly cli: PoolClient) {}
  async get(ref: DocRef): Promise<DocSnap>;
  async get(q: Query): Promise<QuerySnap>;
  async get(x: DocRef | Query): Promise<DocSnap | QuerySnap> {
    if (x instanceof DocRef) return new DocSnap(x, await leerDoc(this.cli, x.coleccion, x.id, true));
    const filas = await ejecutarConsulta(this.cli, x.consulta, true);
    const db = (x as unknown as { db: Db }).db;
    return new QuerySnap(filas.map((f) => new DocSnap(new DocRef(db, x.consulta.coleccion, f.id), f.data)));
  }
  set(ref: DocRef, data: Data, opts?: { merge?: boolean }) {
    this.pendientes.push({ tipo: "set", coleccion: ref.coleccion, id: ref.id, data, merge: opts?.merge });
    return this;
  }
  update(ref: DocRef, data: Data) {
    this.pendientes.push({ tipo: "update", coleccion: ref.coleccion, id: ref.id, data });
    return this;
  }
  create(ref: DocRef, data: Data) {
    this.pendientes.push({ tipo: "create", coleccion: ref.coleccion, id: ref.id, data });
    return this;
  }
  delete(ref: DocRef) {
    this.pendientes.push({ tipo: "delete", coleccion: ref.coleccion, id: ref.id });
    return this;
  }
  async _aplicar() {
    for (const op of this.pendientes) await aplicarEscritura(this.cli, op);
  }
}

class Lote {
  private ops: OpEscritura[] = [];
  set(ref: DocRef, data: Data, opts?: { merge?: boolean }) {
    this.ops.push({ tipo: "set", coleccion: ref.coleccion, id: ref.id, data, merge: opts?.merge });
    return this;
  }
  update(ref: DocRef, data: Data) {
    this.ops.push({ tipo: "update", coleccion: ref.coleccion, id: ref.id, data });
    return this;
  }
  create(ref: DocRef, data: Data) {
    this.ops.push({ tipo: "create", coleccion: ref.coleccion, id: ref.id, data });
    return this;
  }
  delete(ref: DocRef) {
    this.ops.push({ tipo: "delete", coleccion: ref.coleccion, id: ref.id });
    return this;
  }
  async commit() {
    if (!this.ops.length) return;
    await enTransaccion(async (cli) => {
      for (const op of this.ops) await aplicarEscritura(cli, op);
    });
  }
}

export class Db {
  collection(path: string) {
    return new CollectionRef(this, path);
  }
  doc(ruta: string) {
    const { coleccion, id } = partirRuta(ruta);
    return new DocRef(this, coleccion, id);
  }
  batch() {
    return new Lote();
  }
  async runTransaction<T>(fn: (tx: Transaccion) => Promise<T>): Promise<T> {
    // Si dos transacciones chocan (serialización), se reintenta como hace Firestore.
    for (let intento = 0; ; intento++) {
      try {
        return await enTransaccion(async (cli) => {
          const tx = new Transaccion(cli);
          const r = await fn(tx);
          await tx._aplicar();
          return r;
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (intento < 4 && (code === "40001" || code === "40P01")) continue;
        throw err;
      }
    }
  }
}

const instancia = new Db();
/** La base (mismo nombre que antes para no tocar el resto del código). */
export function adminDb(): Db {
  return instancia;
}
