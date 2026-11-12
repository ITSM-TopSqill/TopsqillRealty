import { Module } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ReportsController } from "./reports.controller";
import { VerificationsController } from "./verifications.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { MediaModule } from "../media/media.module";
import { ListingsModule } from "../listings/listings.module";

@Module({ imports: [NotificationsModule, MediaModule, ListingsModule], providers: [AdminService], controllers: [AdminController, ReportsController, VerificationsController], exports: [AdminService] })
export class AdminModule {}
