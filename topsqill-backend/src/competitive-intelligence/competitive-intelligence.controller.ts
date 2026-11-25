import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { CompetitiveIntelligenceService } from "./competitive-intelligence.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class SearchQueryDto {
  @IsString() @MaxLength(200) q: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

/**
 * Competitive Intelligence: a real, on-demand search of Meta's public Ad
 * Library (the one source with a genuine public API) - no persisted
 * monitoring, no fabricated performance numbers.
 */
@ApiTags("competitive-intelligence")
@Controller("v1/competitive-intelligence")
export class CompetitiveIntelligenceController {
  constructor(private readonly svc: CompetitiveIntelligenceService) {}

  @Get("ads") @ApiOperation({ summary: "Search Meta's public Ad Library for real, currently/recently running ads matching a term" })
  search(@CurrentUser() user: AuthUser, @Query() dto: SearchQueryDto) { return this.svc.searchAds(user.id, dto.q, dto.limit ?? 20); }
}
