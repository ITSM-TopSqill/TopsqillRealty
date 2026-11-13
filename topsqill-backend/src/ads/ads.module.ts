import { Module } from "@nestjs/common";
import { AdsService } from "./ads.service";
import { WalletController, CampaignAdsController, AdsWebhooksController, AdsAdminController } from "./ads.controller";
import { LeadsModule } from "../leads/leads.module";
import { NotificationsModule } from "../notifications/notifications.module";

/** Managed ads on Topsqill's Meta and Google accounts, paid from members' wallets. */
@Module({
  imports: [LeadsModule, NotificationsModule],
  providers: [AdsService],
  controllers: [WalletController, CampaignAdsController, AdsWebhooksController, AdsAdminController],
  exports: [AdsService],
})
export class AdsModule {}
