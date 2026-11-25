import { Module } from "@nestjs/common";
import { CompetitiveIntelligenceService } from "./competitive-intelligence.service";
import { CompetitiveIntelligenceController } from "./competitive-intelligence.controller";

@Module({ providers: [CompetitiveIntelligenceService], controllers: [CompetitiveIntelligenceController], exports: [CompetitiveIntelligenceService] })
export class CompetitiveIntelligenceModule {}
