import { Module } from "@nestjs/common";
import { BusinessService } from "./business.service";
import { GenericCampaignsService } from "./generic-campaigns.service";
import { BusinessController } from "./business.controller";

@Module({
  providers: [BusinessService, GenericCampaignsService],
  controllers: [BusinessController],
  exports: [BusinessService, GenericCampaignsService],
})
export class BusinessModule {}
