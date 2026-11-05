import { Module } from "@nestjs/common";
import { FeedService } from "./feed.service";
import { FeedController } from "./feed.controller";
import { MediaModule } from "../media/media.module";

@Module({ imports: [MediaModule], providers: [FeedService], controllers: [FeedController], exports: [FeedService] })
export class FeedModule {}
