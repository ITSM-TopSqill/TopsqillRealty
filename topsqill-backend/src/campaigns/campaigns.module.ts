import { Module } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { MarketingAssistantService } from "./marketing-assistant.service";
import { CampaignEvolutionService } from "./evolution.service";
import { CampaignsController } from "./campaigns.controller";
import { SearchModule } from "../search/search.module";
import { GeoModule } from "../geo/geo.module";
import { BusinessModule } from "../business/business.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { CustomerIntelligenceModule } from "../customer-intelligence/customer-intelligence.module";
import { CompetitiveIntelligenceModule } from "../competitive-intelligence/competitive-intelligence.module";

@Module({
  imports: [SearchModule, GeoModule, BusinessModule, IntegrationsModule, CustomerIntelligenceModule, CompetitiveIntelligenceModule],
  providers: [CampaignsService, MarketingAssistantService, CampaignEvolutionService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
