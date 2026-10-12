// Prodi Software usa tablas propias (hub_*) en la misma base de Prodi. El código vino de MP Socios, que
// consultaba con el driver de Neon: sql`select … where id = ${id}` → filas. Esto hace lo mismo sobre el pool
// de Prodi (los valores siempre van como parámetros, nunca pegados al texto).

import { getPool } from "../db";

export type Fila = Record<string, unknown>;
export type Sql = <T = Fila>(textos: TemplateStringsArray, ...valores: unknown[]) => Promise<T[]>;

const sql: Sql = async <T = Fila>(textos: TemplateStringsArray, ...valores: unknown[]): Promise<T[]> => {
  let texto = textos[0];
  for (let i = 0; i < valores.length; i++) texto += `$${i + 1}${textos[i + 1]}`;
  const r = await getPool().query(texto, valores as unknown[]);
  return r.rows as T[];
};

export function getSql(): Sql {
  return sql;
}
