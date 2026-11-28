import { Module } from "@nestjs/common";
import { CompetitiveIntelligenceService } from "./competitive-intelligence.service";
import { CompetitorDiscoveryService } from "./competitor-discovery.service";
import { CompetitorCreativeAnalysisService } from "./competitor-creative-analysis.service";
import { MarketGapAnalysisService } from "./market-gap.service";
import { CompetitiveStrategyService } from "./competitive-strategy.service";
import { CreativeOpportunityService } from "./creative-opportunity.service";
import { CompetitiveIntelligenceController } from "./competitive-intelligence.controller";

const PROVIDERS = [
  CompetitiveIntelligenceService, CompetitorDiscoveryService, CompetitorCreativeAnalysisService,
  MarketGapAnalysisService, CompetitiveStrategyService, CreativeOpportunityService,
];

@Module({
  providers: PROVIDERS,
  controllers: [CompetitiveIntelligenceController],
  exports: PROVIDERS,
})
export class CompetitiveIntelligenceModule {}
