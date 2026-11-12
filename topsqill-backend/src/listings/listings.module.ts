import { Module } from "@nestjs/common";
import { ListingsService } from "./listings.service";
import { ListingReviewService } from "./review.service";
import { ListingsController } from "./listings.controller";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({ imports: [MediaModule, NotificationsModule], providers: [ListingsService, ListingReviewService], controllers: [ListingsController], exports: [ListingsService, ListingReviewService] })
export class ListingsModule {}
