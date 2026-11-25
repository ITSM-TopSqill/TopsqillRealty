import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, MaxLength, ArrayMaxSize } from "class-validator";
import { BusinessService } from "./business.service";
import { GenericCampaignsService } from "./generic-campaigns.service";
import { INDUSTRIES } from "./industries";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

const INDUSTRY_IDS = INDUSTRIES.map((i) => i.id);

class DescribeDto { @IsString() @MaxLength(1500) description: string; }

class CreateBusinessDto {
  @IsString() @MaxLength(160) name: string;
  @IsIn(INDUSTRY_IDS) industryId: string;
  @IsOptional() @IsString() @MaxLength(120) businessModel?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) products?: string;
  @IsOptional() @IsString() @MaxLength(1000) targetSegments?: string;
  @IsOptional() @IsString() @MaxLength(500) geographicMarkets?: string;
  @IsOptional() @IsString() @MaxLength(1000) pricingNotes?: string;
  @IsOptional() @IsString() @MaxLength(120) revenueModel?: string;
  @IsOptional() @IsString() @MaxLength(1000) acquisitionGoals?: string;
  @IsOptional() @IsString() @MaxLength(60) salesCycle?: string;
  @IsOptional() @IsInt() @Min(1) marketingBudgetInr?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) existingChannels?: string[];
}

class CreateGenericCampaignDto {
  @IsString() businessId: string;
  @IsString() @MaxLength(160) name: string;
  @IsString() @MaxLength(60) objective: string;
  @IsString() @MaxLength(80) conversionEvent: string;
  @IsInt() @Min(1) budgetInr: number;
  @IsOptional() @IsInt() @Min(3) days?: number;
  @IsOptional() @IsString() @MaxLength(400) notes?: string;
}

/**
 * Universal Multi-Industry Support: business profiles and draft marketing
 * plans for anything other than real estate. The dedicated /v1/campaigns
 * flow (listings, BHK, locality) is untouched by any of this.
 */
@ApiTags("business")
@Controller("v1/business")
export class BusinessController {
  constructor(private readonly svc: BusinessService, private readonly campaigns: GenericCampaignsService) {}

  @Get("industries") @ApiOperation({ summary: "The universal industry taxonomy, grouped by sector" })
  industries() { return this.svc.industries(); }

  @Post("describe") @ApiOperation({ summary: "Turn a free-text business description into a reviewable draft profile (saves nothing)" })
  describe(@CurrentUser() user: AuthUser, @Body() dto: DescribeDto) { return this.svc.draftFromDescription(user.id, dto.description); }

  @Post() @ApiOperation({ summary: "Save a business profile" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBusinessDto) { return this.svc.create(user.id, dto); }

  @Get()
  list(@CurrentUser() user: AuthUser) { return this.svc.list(user.id); }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.get(user.id, id); }

  @Get(":id/campaigns") @ApiOperation({ summary: "This business's draft marketing plans" })
  campaignsForBusiness(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.campaigns.list(user.id, id); }

  @Post("campaigns") @ApiOperation({ summary: "Draft a marketing plan for a business (objective + conversion event + budget). Not launched to any channel yet." })
  createCampaign(@CurrentUser() user: AuthUser, @Body() dto: CreateGenericCampaignDto) { return this.campaigns.create(user.id, dto); }

  @Get("campaigns/:id")
  getCampaign(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.campaigns.get(user.id, id); }
}
