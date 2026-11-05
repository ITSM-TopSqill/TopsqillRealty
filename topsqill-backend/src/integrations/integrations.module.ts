import { Module } from "@nestjs/common";
import { AdPlatformsService } from "./ad-platforms.service";
import { WhatsAppService } from "./whatsapp.service";
import { SecretsService } from "./secrets.service";
import { IntegrationsController } from "./integrations.controller";
import { LeadsModule } from "../leads/leads.module";

@Module({
  imports: [LeadsModule],
  providers: [AdPlatformsService, WhatsAppService, SecretsService],
  controllers: [IntegrationsController],
  exports: [AdPlatformsService, WhatsAppService, SecretsService],
})
export class IntegrationsModule {}
