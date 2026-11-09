import { Global, Module, Injectable, Inject, OnModuleDestroy } from "@nestjs/common";
import { Queue, JobsOptions } from "bullmq";
import Redis from "ioredis";
import { REDIS } from "../redis/redis.module";

import { QUEUES, type QueueName } from "./queues";

/** Anything slow runs on these queues so the API answers immediately. */
export { QUEUES, type QueueName };

const defaults: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) { // BullMQ needs its own connection with retries left to it, not our fail-fast cache settings.
      q = new Queue(name, { connection: this.redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null, commandTimeout: undefined }), defaultJobOptions: defaults }); this.queues.set(name, q); }
    return q;
  }

  /**
   * `jobId` makes a job idempotent: the same work is never queued twice.
   * BullMQ reserves ":" in job ids, so it is replaced here rather than relying
   * on every caller to remember.
   */
  add(name: QueueName, job: string, data: unknown, jobId?: string) {
    const safeId = jobId?.replace(/:/g, "-");
    return this.queue(name).add(job, data, safeId ? { jobId: safeId } : undefined);
  }

  async onModuleDestroy() { for (const q of this.queues.values()) await q.close().catch(() => {}); }
}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
