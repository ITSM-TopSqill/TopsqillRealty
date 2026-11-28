import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, IsInt, Min, Max, IsIn } from "class-validator";
import { Type } from "class-transformer";
import { CompetitiveIntelligenceService } from "./competitive-intelligence.service";
import { CompetitorDiscoveryService, CATEGORIES, type Category } from "./competitor-discovery.service";
import { CompetitorCreativeAnalysisService } from "./competitor-creative-analysis.service";
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

class AddCompetitorDto {
  @IsString() @MaxLength(160) name: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  @IsOptional() @IsIn(CATEGORIES) category?: Category;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class SuggestCompetitorsDto { @IsOptional() @IsString() businessId?: string; }

class SetCompetitorStatusDto { @IsIn(["accepted", "rejected"]) status: "accepted" | "rejected"; }

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
  ) {}

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

  @Post("analyse") @ApiOperation({ summary: "Run and save a structured visual/copy/commercial creative-strategy analysis over real ads for a search" })
  analyse(@CurrentUser() user: AuthUser, @Body() dto: AnalyseDto) { return this.analysis.analyse(user.id, dto.searchTerms, dto.competitorId); }

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
}
