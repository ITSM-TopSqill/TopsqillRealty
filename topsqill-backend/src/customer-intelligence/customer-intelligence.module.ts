import { Module } from "@nestjs/common";
import { CustomerIntelligenceService } from "./customer-intelligence.service";
import { CustomerIntelligenceController } from "./customer-intelligence.controller";

@Module({ providers: [CustomerIntelligenceService], controllers: [CustomerIntelligenceController], exports: [CustomerIntelligenceService] })
export class CustomerIntelligenceModule {}
