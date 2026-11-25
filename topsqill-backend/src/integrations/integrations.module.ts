import { Module } from "@nestjs/common";
import { WhatsAppService } from "./whatsapp.service";
import { SecretsService } from "./secrets.service";
import { IntegrationsController } from "./integrations.controller";
import { LeadsModule } from "../leads/leads.module";
import { MediaModule } from "../media/media.module";
import { MediaInboxService } from "./media-inbox.service";
import { InstagramService } from "./instagram.service";
import { FacebookService } from "./facebook.service";
import { ProviderRegistryService } from "./provider-registry.service";

@Module({
  imports: [LeadsModule, MediaModule],
  providers: [WhatsAppService, SecretsService, MediaInboxService, InstagramService, FacebookService, ProviderRegistryService],
  controllers: [IntegrationsController],
  exports: [WhatsAppService, SecretsService, ProviderRegistryService],
})
export class IntegrationsModule {}
