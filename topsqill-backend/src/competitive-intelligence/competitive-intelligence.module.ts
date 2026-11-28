import { Module } from "@nestjs/common";
import { CompetitiveIntelligenceService } from "./competitive-intelligence.service";
import { CompetitorDiscoveryService } from "./competitor-discovery.service";
import { CompetitorCreativeAnalysisService } from "./competitor-creative-analysis.service";
import { MarketGapAnalysisService } from "./market-gap.service";
import { CompetitiveStrategyService } from "./competitive-strategy.service";
import { CompetitiveIntelligenceController } from "./competitive-intelligence.controller";

@Module({
  providers: [
    CompetitiveIntelligenceService, CompetitorDiscoveryService, CompetitorCreativeAnalysisService,
    MarketGapAnalysisService, CompetitiveStrategyService,
  ],
  controllers: [CompetitiveIntelligenceController],
  exports: [
    CompetitiveIntelligenceService, CompetitorDiscoveryService, CompetitorCreativeAnalysisService,
    MarketGapAnalysisService, CompetitiveStrategyService,
  ],
})
export class CompetitiveIntelligenceModule {}
