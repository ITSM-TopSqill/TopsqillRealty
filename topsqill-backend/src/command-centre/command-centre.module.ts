import { Module } from "@nestjs/common";
import { CommandCentreService } from "./command-centre.service";
import { CommandCentreController } from "./command-centre.controller";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { BusinessModule } from "../business/business.module";
import { CustomerIntelligenceModule } from "../customer-intelligence/customer-intelligence.module";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [CampaignsModule, BusinessModule, CustomerIntelligenceModule, IntegrationsModule],
  providers: [CommandCentreService],
  controllers: [CommandCentreController],
})
export class CommandCentreModule {}
