import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, IsInt, Min, Max, IsIn, IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { CompetitiveIntelligenceService } from "./competitive-intelligence.service";
import { CompetitorDiscoveryService, CATEGORIES, type Category } from "./competitor-discovery.service";
import { CompetitorCreativeAnalysisService } from "./competitor-creative-analysis.service";
import { MarketGapAnalysisService } from "./market-gap.service";
import { CompetitiveStrategyService } from "./competitive-strategy.service";
import { CreativeOpportunityService } from "./creative-opportunity.service";
import { AudienceStrategyService } from "./audience-strategy.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class SearchQueryDto {
  @IsString() @MaxLength(200) q: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class CreateWatchDto {
  @IsString() @MaxLength(200) searchTerms: string;
  @IsOptional() @IsString() competitorId?: string;
}

class AnalyseDto {
  @IsString() @MaxLength(200) searchTerms: string;
  @IsOptional() @IsString() competitorId?: string;
}

class ManualAdDto {
  @IsString() @MaxLength(160) pageName: string;
  @IsOptional() @IsString() @MaxLength(300) headline?: string;
  @IsOptional() @IsString() @MaxLength(2000) body?: string;
}

class AnalyseManualDto {
  @IsString() @MaxLength(200) label: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ManualAdDto) ads: ManualAdDto[];
  @IsOptional() @IsString() competitorId?: string;
}

class AddCompetitorDto {
  @IsString() @MaxLength(160) name: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  @IsOptional() @IsIn(CATEGORIES) category?: Category;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class SuggestCompetitorsDto { @IsOptional() @IsString() businessId?: string; }

class SetCompetitorStatusDto { @IsIn(["accepted", "rejected"]) status: "accepted" | "rejected"; }

class AnalyseGapDto {
  @IsOptional() @IsString() businessId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsString({ each: true }) competitorIds: string[];
}

class GenerateStrategyDto {
  @IsOptional() @IsString() businessId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsString({ each: true }) competitorIds: string[];
  @IsOptional() @IsString() marketGapAnalysisId?: string;
}

class ResolveItemDto { @IsIn(["approved", "rejected"]) status: "approved" | "rejected"; }

class GenerateConceptsDto {
  @IsOptional() @IsString() marketGapAnalysisId?: string;
  @IsOptional() @IsString() opportunityId?: string;
  @IsOptional() @IsString() competitiveStrategyId?: string;
  @IsOptional() @IsString() strategyItemId?: string;
}

class CreateCampaignFromConceptDto {
  @IsString() businessId: string;
  @IsInt() @Min(1) budgetInr: number;
  @IsOptional() @IsInt() @Min(3) @Max(90) days?: number;
  @IsOptional() @IsString() objective?: string;
  @IsOptional() @IsString() conversionEvent?: string;
}

class GenerateAudienceStrategyDto {
  @IsString() businessId: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) competitorIds?: string[];
}

/**
 * Competitive Intelligence: competitor discovery (Module 1), a real,
 * on-demand search of Meta's public Ad Library (Module 2, the one source
 * with a genuine public API - no fabricated performance numbers), a
 * persisted structured creative-strategy analysis (Module 3), and
 * Continuous Market Learning watches (Module 12, new-ad notifications
 * only).
 */
@ApiTags("competitive-intelligence")
@Controller("v1/competitive-intelligence")
export class CompetitiveIntelligenceController {
  constructor(
    private readonly svc: CompetitiveIntelligenceService,
    private readonly discovery: CompetitorDiscoveryService,
    private readonly analysis: CompetitorCreativeAnalysisService,
    private readonly gaps: MarketGapAnalysisService,
    private readonly strategies: CompetitiveStrategyService,
    private readonly concepts: CreativeOpportunityService,
    private readonly audiences: AudienceStrategyService,
  ) {}

  /* ------------------------------ dashboard ------------------------------ */

  @Get("dashboard") @ApiOperation({ summary: "A single real-data view across every competitive-intelligence module - no new calculations, nothing invented" })
  dashboard(@CurrentUser() user: AuthUser, @Query("businessId") businessId?: string) { return this.svc.dashboard(user.id, businessId); }

  /* ------------------------------ ad search ------------------------------ */

  @Get("ads") @ApiOperation({ summary: "Search Meta's public Ad Library for real, currently/recently running ads matching a term" })
  search(@CurrentUser() user: AuthUser, @Query() dto: SearchQueryDto) { return this.svc.searchAds(user.id, dto.q, dto.limit ?? 20); }

  @Post("watches") @ApiOperation({ summary: "Save a search for the background worker to re-check on a schedule, notifying only of genuinely new ads" })
  createWatch(@CurrentUser() user: AuthUser, @Body() dto: CreateWatchDto) { return this.svc.createWatch(user.id, dto.searchTerms, dto.competitorId); }

  @Get("watches")
  listWatches(@CurrentUser() user: AuthUser) { return this.svc.listWatches(user.id); }

  @Delete("watches/:id")
  removeWatch(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.removeWatch(user.id, id); }

  /* ----------------------------- creative analysis ----------------------------- */

  @Post("analyse") @ApiOperation({ summary: "Run and save a structured visual/copy/commercial creative-strategy analysis over real ads for a search (Meta Ad Library - UK/EU only)" })
  analyse(@CurrentUser() user: AuthUser, @Body() dto: AnalyseDto) { return this.analysis.analyse(user.id, dto.searchTerms, dto.competitorId); }

  @Post("analyse-manual") @ApiOperation({ summary: "Run and save a structured creative-strategy analysis over ads typed in by hand - for markets Meta's Ad Library doesn't serve" })
  analyseManual(@CurrentUser() user: AuthUser, @Body() dto: AnalyseManualDto) { return this.analysis.analyseManual(user.id, dto.label, dto.ads, dto.competitorId); }

  @Get("analyses") @ApiOperation({ summary: "List previously saved creative-strategy analyses" })
  listAnalyses(@CurrentUser() user: AuthUser, @Query("competitorId") competitorId?: string, @Query("limit") limit?: string) {
    return this.analysis.list(user.id, competitorId, limit ? Number(limit) : undefined);
  }

  /* ------------------------------ competitors ------------------------------ */

  @Post("competitors") @ApiOperation({ summary: "Add a competitor by hand" })
  addCompetitor(@CurrentUser() user: AuthUser, @Body() dto: AddCompetitorDto) { return this.discovery.add(user.id, dto); }

  @Get("competitors") @ApiOperation({ summary: "List tracked competitors (manual and AI-suggested, any status)" })
  listCompetitors(@CurrentUser() user: AuthUser) { return this.discovery.list(user.id); }

  @Post("competitors/suggest") @ApiOperation({ summary: "Ask AI to suggest competitors from a business profile - saved as status 'suggested', never auto-accepted" })
  suggestCompetitors(@CurrentUser() user: AuthUser, @Body() dto: SuggestCompetitorsDto) { return this.discovery.suggest(user.id, dto.businessId); }

  @Patch("competitors/:id") @ApiOperation({ summary: "Accept or reject a competitor (manual or suggested)" })
  setCompetitorStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: SetCompetitorStatusDto) {
    return this.discovery.setStatus(user.id, id, dto.status);
  }

  @Delete("competitors/:id")
  removeCompetitor(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.discovery.remove(user.id, id); }

  /* ------------------------------ market gaps ------------------------------ */

  @Post("market-gaps") @ApiOperation({ summary: "Find evidence-grounded growth opportunities by comparing your business against tracked competitors" })
  analyseGaps(@CurrentUser() user: AuthUser, @Body() dto: AnalyseGapDto) { return this.gaps.analyse(user.id, dto); }

  @Get("market-gaps") @ApiOperation({ summary: "List past market-gap analyses" })
  listGaps(@CurrentUser() user: AuthUser, @Query("businessId") businessId?: string) { return this.gaps.list(user.id, businessId); }

  @Get("market-gaps/:id")
  getGap(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.gaps.get(user.id, id); }

  @Post("market-gaps/:id/opportunities/:oppId/resolve") @ApiOperation({ summary: "Approve or reject one opportunity" })
  resolveOpportunity(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("oppId") oppId: string, @Body() dto: ResolveItemDto) {
    return this.gaps.resolveOpportunity(user.id, id, oppId, dto.status);
  }

  /* ------------------------------ strategies ------------------------------ */

  @Post("strategies") @ApiOperation({ summary: "Generate 1-3 differentiation strategies grounded in your business, competitors and (optionally) an approved market-gap analysis" })
  generateStrategies(@CurrentUser() user: AuthUser, @Body() dto: GenerateStrategyDto) { return this.strategies.generate(user.id, dto); }

  @Get("strategies") @ApiOperation({ summary: "List past strategy generations" })
  listStrategies(@CurrentUser() user: AuthUser, @Query("businessId") businessId?: string) { return this.strategies.list(user.id, businessId); }

  @Get("strategies/:id")
  getStrategy(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.strategies.get(user.id, id); }

  @Post("strategies/:id/items/:stratId/resolve") @ApiOperation({ summary: "Approve or reject one strategy" })
  resolveStrategy(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("stratId") stratId: string, @Body() dto: ResolveItemDto) {
    return this.strategies.resolveStrategy(user.id, id, stratId, dto.status);
  }

  /* ------------------------------ creative concepts ------------------------------ */

  @Post("concepts") @ApiOperation({ summary: "Generate original campaign concepts grounded in exactly one approved market-gap opportunity or strategy" })
  generateConcepts(@CurrentUser() user: AuthUser, @Body() dto: GenerateConceptsDto) { return this.concepts.generate(user.id, dto); }

  @Get("concepts") @ApiOperation({ summary: "List past creative-concept generations" })
  listConcepts(@CurrentUser() user: AuthUser) { return this.concepts.list(user.id); }

  @Get("concepts/:id")
  getConcepts(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.concepts.get(user.id, id); }

  @Post("concepts/:id/items/:conceptId/resolve") @ApiOperation({ summary: "Approve or reject one concept" })
  resolveConcept(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("conceptId") conceptId: string, @Body() dto: ResolveItemDto) {
    return this.concepts.resolveConcept(user.id, id, conceptId, dto.status);
  }

  @Post("concepts/:id/items/:conceptId/create-campaign") @ApiOperation({ summary: "Turn an approved concept into a real draft campaign (review and launch it from there - this never launches on its own)" })
  createCampaignFromConcept(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("conceptId") conceptId: string, @Body() dto: CreateCampaignFromConceptDto) {
    return this.concepts.createCampaign(user.id, id, conceptId, dto);
  }

  /* ------------------------------ audience strategy ------------------------------ */

  @Post("audience-strategy") @ApiOperation({ summary: "Find audience segment hypotheses grounded in your business profile, saved CRM segments and (optionally) tracked competitors" })
  generateAudienceStrategy(@CurrentUser() user: AuthUser, @Body() dto: GenerateAudienceStrategyDto) { return this.audiences.generate(user.id, dto); }

  @Get("audience-strategy") @ApiOperation({ summary: "List past audience-strategy generations" })
  listAudienceStrategies(@CurrentUser() user: AuthUser, @Query("businessId") businessId?: string) { return this.audiences.list(user.id, businessId); }

  @Get("audience-strategy/:id")
  getAudienceStrategy(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.audiences.get(user.id, id); }

  @Post("audience-strategy/:id/segments/:segId/resolve") @ApiOperation({ summary: "Approve or reject one audience segment" })
  resolveAudienceSegment(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("segId") segId: string, @Body() dto: ResolveItemDto) {
    return this.audiences.resolveSegment(user.id, id, segId, dto.status);
  }
}
