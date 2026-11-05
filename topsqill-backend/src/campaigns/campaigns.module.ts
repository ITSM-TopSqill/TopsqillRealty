import { Module } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { CampaignsController } from "./campaigns.controller";
import { SearchModule } from "../search/search.module";

@Module({ imports: [SearchModule], providers: [CampaignsService], controllers: [CampaignsController], exports: [CampaignsService] })
export class CampaignsModule {}
