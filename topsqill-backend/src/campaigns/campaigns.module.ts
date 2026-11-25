import { Module } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { MarketingAssistantService } from "./marketing-assistant.service";
import { CampaignsController } from "./campaigns.controller";
import { SearchModule } from "../search/search.module";
import { GeoModule } from "../geo/geo.module";
import { BusinessModule } from "../business/business.module";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [SearchModule, GeoModule, BusinessModule, IntegrationsModule],
  providers: [CampaignsService, MarketingAssistantService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
