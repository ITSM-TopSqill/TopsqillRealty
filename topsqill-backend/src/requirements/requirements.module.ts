import { Module } from "@nestjs/common";
import { RequirementsService } from "./requirements.service";
import { RequirementsController } from "./requirements.controller";

import { MessagingModule } from "../messaging/messaging.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({ imports: [MessagingModule, NotificationsModule], providers: [RequirementsService], controllers: [RequirementsController], exports: [RequirementsService] })
export class RequirementsModule {}
