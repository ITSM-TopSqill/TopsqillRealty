import "reflect-metadata";
import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { Pool } from "pg";
import { env } from "../src/common/env";
import { QUEUES } from "../src/queue/queue.module";
import { processMedia } from "./media.processor";
import { fanoutPost } from "./fanout.processor";
import { flushCounters } from "./counters";
import { syncLiveCampaigns } from "./campaign-sync";
import { runMatch } from "./match.processor";

/**
 * Background workers. Everything slow lives here so the API always answers fast:
 * image resizing, video to HLS, 3D compression, feed delivery and counter writes.
 * Runs as its own Cloud Run service, scaled separately from the API.
 */
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5, application_name: "topsqill-worker" });
const log = (m: string, extra?: unknown) => console.log(JSON.stringify({ severity: "INFO", message: m, extra }));

const workers = [
  new Worker(QUEUES.media, async (job: Job) => processMedia(job, pool), { connection, concurrency: 4 }),
  new Worker(QUEUES.fanout, async (job: Job) => fanoutPost(job, pool, connection), { connection, concurrency: 8 }),
  new Worker(QUEUES.ai, async (job: Job) => runMatch(job, pool), { connection, concurrency: 4 }),
];

for (const w of workers) {
  w.on("failed", (job, err) => console.error(JSON.stringify({ severity: "ERROR", message: `job failed: ${job?.name}`, error: err.message })));
  w.on("completed", (job) => log(`job done: ${job.name}`, { id: job.id }));
}

// View and like counts are buffered in Redis and written in batches every 30s.
const timer = setInterval(() => flushCounters(pool, connection).catch((e) => console.error("counter flush", e.message)), 30_000);
// Ad platforms are polled every 15 minutes: often enough to be useful, far
// below the rate limits, and it keeps the member's spend figures honest.
const statsTimer = setInterval(() => syncLiveCampaigns(pool).catch((e) => console.error("campaign sync", e.message)), 15 * 60_000);

async function shutdown() {
  clearInterval(timer);
  clearInterval(statsTimer);
  await Promise.all(workers.map((w) => w.close()));
  await pool.end().catch(() => {});
  await connection.quit().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
log("Topsqill.ai workers started");
