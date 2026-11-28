import { Module } from "@nestjs/common";
import { CompetitiveIntelligenceService } from "./competitive-intelligence.service";
import { CompetitorDiscoveryService } from "./competitor-discovery.service";
import { CompetitorCreativeAnalysisService } from "./competitor-creative-analysis.service";
import { CompetitiveIntelligenceController } from "./competitive-intelligence.controller";

@Module({
  providers: [CompetitiveIntelligenceService, CompetitorDiscoveryService, CompetitorCreativeAnalysisService],
  controllers: [CompetitiveIntelligenceController],
  exports: [CompetitiveIntelligenceService, CompetitorDiscoveryService, CompetitorCreativeAnalysisService],
})
export class CompetitiveIntelligenceModule {}
