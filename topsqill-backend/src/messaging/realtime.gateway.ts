import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import Redis from "ioredis";
import { REDIS } from "../redis/redis.module";

type Client = { send: (data: string) => void; userId: string; rooms: Set<string> };

/**
 * Real-time delivery over WebSocket.
 *
 * Every API container subscribes to Redis, so a message sent on container A
 * reaches a phone connected to container B. Without this, chat would only work
 * when both people happened to hit the same server.
 */
@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("realtime");
  private readonly clients = new Set<Client>();
  private sub!: Redis;

  constructor(@Inject(REDIS) private readonly redis: Redis, private readonly jwt: JwtService) {}

  onModuleInit() {
    // A dedicated connection: a subscriber cannot run normal commands, and it
    // keeps its offline queue so it reconnects cleanly after a Redis restart.
    this.sub = this.redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null, commandTimeout: undefined });
    this.sub.on("error", (e) => this.log.warn("subscriber error: " + e.message));
    this.sub.on("ready", () => { this.sub.psubscribe("user:*", "convo:*").catch((e) => this.log.warn("subscribe failed: " + e.message)); });
    this.sub.on("pmessage", (_pattern, channel, payload) => {
      for (const c of this.clients) if (c.rooms.has(channel)) {
        try { c.send(payload); } catch { this.clients.delete(c); }
      }
    });
  }

  async onModuleDestroy() { await this.sub?.quit().catch(() => {}); }

  /** Called by the WebSocket route once the token is verified. */
  register(client: Client) { this.clients.add(client); }
  unregister(client: Client) { this.clients.delete(client); }

  async verify(token: string): Promise<string | null> {
    try { const p = await this.jwt.verifyAsync(token); return p.sub as string; } catch { return null; }
  }

  get connectionCount() { return this.clients.size; }
}
