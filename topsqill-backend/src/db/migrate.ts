import { Pool } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../common/env";
import { poolConfig } from "./pool-config";

/** Applies the SQL files in ./drizzle in order, once each. */
async function main() {
  const pool = new Pool(poolConfig(env.DATABASE_URL));
  await pool.query(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`);
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const done = await pool.query("select 1 from _migrations where name = $1", [f]);
    if (done.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(readFileSync(join(dir, f), "utf8"));
      await client.query("insert into _migrations(name) values ($1)", [f]);
      await client.query("commit");
      console.log("applied", f);
    } catch (e) { await client.query("rollback"); throw e; }
    finally { client.release(); }
  }
  await pool.end();
  console.log("migrations up to date");
}
main().catch((e) => { console.error(e); process.exit(1); });
