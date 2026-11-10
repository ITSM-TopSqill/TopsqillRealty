import { Module } from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { JobsController } from "./jobs.controller";

import { NotificationsModule } from "../notifications/notifications.module";

@Module({ imports: [NotificationsModule], providers: [JobsService], controllers: [JobsController], exports: [JobsService] })
export class JobsModule {}
