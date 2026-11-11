import "reflect-metadata";
import { createServer } from "node:http";
import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { Pool } from "pg";
import { env } from "../src/common/env";
import { poolConfig } from "../src/db/pool-config";
import { QUEUES } from "../src/queue/queues";
import { processMedia, checkTranscodes } from "./media.processor";
import { fanoutPost } from "./fanout.processor";
import { flushCounters } from "./counters";
import { syncLiveCampaigns } from "./campaign-sync";
import { runMatch } from "./match.processor";
import { deliverNotification } from "./notify.processor";

/**
 * Background workers. Everything slow lives here so the API always answers fast:
 * image resizing, video to HLS, 3D compression, feed delivery and counter writes.
 * Runs as its own Cloud Run service, scaled separately from the API.
 *
 * Cloud Run only keeps a container that answers on $PORT, so a tiny HTTP server
 * reports health: /health means the process is up (used by the probes, so a
 * Redis blip never restarts the container), /ready also needs Redis.
 */
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const pool = new Pool(poolConfig(env.DATABASE_URL, { max: 5, application_name: "topsqill-worker" }));
const log = (m: string, extra?: unknown) => console.log(JSON.stringify({ severity: "INFO", message: m, extra }));

const workers = [
  new Worker(QUEUES.media, async (job: Job) => processMedia(job, pool, connection), { connection, concurrency: 4 }),
  new Worker(QUEUES.fanout, async (job: Job) => fanoutPost(job, pool, connection), { connection, concurrency: 8 }),
  new Worker(QUEUES.ai, async (job: Job) => runMatch(job, pool, connection), { connection, concurrency: 4 }),
  // Alert emails. Previously nothing consumed this queue, so they piled up in Redis unsent.
  new Worker(QUEUES.notify, async (job: Job) => deliverNotification(job, pool, connection), { connection, concurrency: 4 }),
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
// Finished streaming versions of uploaded videos are picked up every minute.
const videoTimer = setInterval(() => checkTranscodes(pool, connection).catch((e) => console.error("transcode check", e.message)), 60_000);

const health = createServer((req, res) => {
  const redisUp = connection.status === "ready";
  const ok = req.url === "/ready" ? redisUp : true;
  res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok, redis: redisUp, workers: workers.filter((w) => w.isRunning()).length }));
});
health.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");

async function shutdown() {
  clearInterval(timer);
  clearInterval(statsTimer);
  clearInterval(videoTimer);
  health.close();
  await Promise.all(workers.map((w) => w.close()));
  await pool.end().catch(() => { });
  await connection.quit().catch(() => { });
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
log("Topsqill.ai workers started");
