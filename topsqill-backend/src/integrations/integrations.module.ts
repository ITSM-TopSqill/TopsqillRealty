import { Module } from "@nestjs/common";
import { AdPlatformsService } from "./ad-platforms.service";
import { WhatsAppService } from "./whatsapp.service";
import { SecretsService } from "./secrets.service";
import { IntegrationsController } from "./integrations.controller";
import { LeadsModule } from "../leads/leads.module";
import { MediaModule } from "../media/media.module";
import { MediaInboxService } from "./media-inbox.service";
import { InstagramService } from "./instagram.service";

@Module({
  imports: [LeadsModule, MediaModule],
  providers: [AdPlatformsService, WhatsAppService, SecretsService, MediaInboxService, InstagramService],
  controllers: [IntegrationsController],
  exports: [AdPlatformsService, WhatsAppService, SecretsService],
})
export class IntegrationsModule {}
