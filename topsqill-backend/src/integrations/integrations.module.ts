import { Module } from "@nestjs/common";
import { WhatsAppService } from "./whatsapp.service";
import { SecretsService } from "./secrets.service";
import { IntegrationsController } from "./integrations.controller";
import { LeadsModule } from "../leads/leads.module";
import { MediaModule } from "../media/media.module";
import { MediaInboxService } from "./media-inbox.service";
import { InstagramService } from "./instagram.service";
import { FacebookService } from "./facebook.service";

@Module({
  imports: [LeadsModule, MediaModule],
  providers: [WhatsAppService, SecretsService, MediaInboxService, InstagramService, FacebookService],
  controllers: [IntegrationsController],
  exports: [WhatsAppService, SecretsService],
})
export class IntegrationsModule {}
