import type { Pool, PoolClient } from "pg";

/**
 * The ads and wallet code is shared by the API (Nest) and the background
 * worker (plain node), so it talks to Postgres through this one small
 * interface instead of either side's own database layer.
 */
export type Q = <T = Record<string, any>>(text: string, params?: unknown[]) => Promise<T[]>;

export const queryOn = (c: Pool | PoolClient): Q => async (text, params) => (await c.query(text, params as unknown[])).rows as never;

/** Runs `fn` in one transaction: everything in it happens, or none of it. */
export async function inTx<T>(pool: Pool, fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(queryOn(client));
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally { client.release(); }
}
