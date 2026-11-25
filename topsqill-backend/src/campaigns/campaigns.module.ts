import { Module } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { MarketingAssistantService } from "./marketing-assistant.service";
import { CampaignsController } from "./campaigns.controller";
import { SearchModule } from "../search/search.module";
import { GeoModule } from "../geo/geo.module";

@Module({
  imports: [SearchModule, GeoModule],
  providers: [CampaignsService, MarketingAssistantService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
