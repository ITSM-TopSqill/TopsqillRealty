import { Module } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import { MessagingController } from "./messaging.controller";
import { RealtimeGateway } from "./realtime.gateway";
import { MediaModule } from "../media/media.module";
import { AuthModule } from "../auth/auth.module";
import { LeadsModule } from "../leads/leads.module";

@Module({
  imports: [MediaModule, AuthModule, LeadsModule],
  providers: [MessagingService, RealtimeGateway],
  controllers: [MessagingController],
  exports: [MessagingService, RealtimeGateway],
})
export class MessagingModule {}
