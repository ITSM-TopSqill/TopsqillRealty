import { Module } from "@nestjs/common";
import { ListingsService } from "./listings.service";
import { ListingsController } from "./listings.controller";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({ imports: [MediaModule, NotificationsModule], providers: [ListingsService], controllers: [ListingsController], exports: [ListingsService] })
export class ListingsModule {}
