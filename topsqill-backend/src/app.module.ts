import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { DbModule } from "./db/db.module";
import { RedisModule } from "./redis/redis.module";
import { QueueModule } from "./queue/queue.module";
import { AuthModule } from "./auth/auth.module";
import { JwtGuard } from "./auth/jwt.guard";
import { ProfilesModule } from "./profiles/profiles.module";
import { ListingsModule } from "./listings/listings.module";
import { MediaModule } from "./media/media.module";
import { FeedModule } from "./feed/feed.module";
import { RequirementsModule } from "./requirements/requirements.module";
import { SearchModule } from "./search/search.module";
import { SavedModule } from "./saved/saved.module";
import { GeoModule } from "./geo/geo.module";
import { AdminModule } from "./admin/admin.module";
import { MessagingModule } from "./messaging/messaging.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { LeadsModule } from "./leads/leads.module";
import { AiModule } from "./ai/ai.module";
import { JobsModule } from "./jobs/jobs.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { AdsModule } from "./ads/ads.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { AccountModule } from "./account/account.module";
import { HealthController } from "./health/health.controller";
import { TimingInterceptor, ErrorFilter } from "./common/http";
import { isProd, getEnv } from "./common/env";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: isProd() ? "info" : "debug",
        // Cloud Logging understands this shape, so logs are searchable in the console.
        messageKey: "message",
        formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
        redact: ["req.headers.authorization", "req.headers.cookie", "req.body.code"],
        autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
      },
    }),
    // Blanket limit per IP. Sensitive endpoints (OTP) add their own tighter limits.
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", ttl: getEnv().THROTTLE_TTL_MS, limit: getEnv().THROTTLE_LIMIT }],
      // Health checks and the CDN-cached search endpoint are not rate limited.
      skipIf: (ctx) => {
        const url: string = ctx.switchToHttp().getRequest()?.url ?? "";
        return url === "/health" || url === "/ready";
      },
    }),
    DbModule, RedisModule, QueueModule,
    AuthModule, ProfilesModule, ListingsModule, MediaModule, FeedModule,
    RequirementsModule, SearchModule, SavedModule, AdminModule, GeoModule,
    NotificationsModule, MessagingModule, LeadsModule,
    AiModule, JobsModule, CampaignsModule, AdsModule, IntegrationsModule, AccountModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_INTERCEPTOR, useClass: TimingInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
