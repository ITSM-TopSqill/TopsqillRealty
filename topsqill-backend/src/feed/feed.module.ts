import { Module } from "@nestjs/common";
import { FeedService } from "./feed.service";
import { FeedController } from "./feed.controller";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({ imports: [MediaModule, NotificationsModule], providers: [FeedService], controllers: [FeedController], exports: [FeedService] })
export class FeedModule {}
