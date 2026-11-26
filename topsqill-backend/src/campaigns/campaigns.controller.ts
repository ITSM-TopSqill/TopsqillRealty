import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Min, MaxLength, IsArray, ArrayMaxSize, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { CampaignsService } from "./campaigns.service";
import { MarketingAssistantService, type Turn } from "./marketing-assistant.service";
import { CampaignEvolutionService } from "./evolution.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class CreateCampaignDto {
  // Either a listingId (promote a listing) or mediaIds + headline + city
  // (a listing-less "From Creative" / "From Video" campaign) must be given;
  // the service checks that, since one or the other is always required.
  @IsOptional() @IsString() listingId?: string;
  // The real floor is the admin's configured minimum (checked in the service);
  // this is just a sanity bound so a bad request can't send ₹0 or less.
  @IsInt() @Min(1) budgetInr: number;
  @IsOptional() @IsInt() @Min(3) days?: number;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsString() @MaxLength(400) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) mediaIds?: string[];
  @IsOptional() @IsString() @MaxLength(60) headline?: string;
  @IsOptional() @IsString() @MaxLength(400) text?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(300) link?: string;
  // Extra localities to target besides the primary one, and areas to exclude;
  // each { label, lat, lng, radiusKm }. Sanitised (bounds, counts) in the service.
  @IsOptional() @IsArray() @ArrayMaxSize(8) extraPlaces?: { label: string; lat: number; lng: number; radiusKm: number }[];
  @IsOptional() @IsArray() @ArrayMaxSize(8) excludePlaces?: { label: string; lat: number; lng: number; radiusKm: number }[];
}

class SuggestAudienceDto {
  @IsString() @MaxLength(400) description: string;
  @IsOptional() @IsString() listingId?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
}

class ResolveRecommendationDto {
  @IsIn(["approved", "rejected", "dismissed"]) status: "approved" | "rejected" | "dismissed";
}

class MediaDto {
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) mediaIds: string[];
}

class RenameDto { @IsString() @MaxLength(160) name: string; }

class ResolveEvolutionChangeDto { @IsIn(["approved", "rejected"]) status: "approved" | "rejected"; }

class AssistantTurnDto {
  @IsIn(["user", "assistant"]) role: "user" | "assistant";
  @IsString() @MaxLength(6000) text: string;
}
class AssistantAskDto {
  @IsString() @MaxLength(1000) message: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AssistantTurnDto) history?: Turn[];
}

class CreativesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) @MaxLength(60, { each: true }) headlines?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(2) @IsString({ each: true }) @MaxLength(400, { each: true }) primaryTexts?: string[];
  @IsOptional() @IsString() @MaxLength(30) cta?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) @MaxLength(30, { each: true }) googleHeadlines?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(2) @IsString({ each: true }) @MaxLength(90, { each: true }) googleDescriptions?: string[];
}

@ApiTags("campaigns")
@Controller("v1/campaigns")
export class CampaignsController {
  constructor(
    private readonly svc: CampaignsService,
    private readonly assistant: MarketingAssistantService,
    private readonly evolution: CampaignEvolutionService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) { return this.svc.list(user.id); }

  @Get("dashboard") @ApiOperation({ summary: "Cross-campaign health, best platform/locality/campaign, and anything pending approval" })
  dashboard(@CurrentUser() user: AuthUser) { return this.svc.dashboard(user.id); }

  @Get("forecast-accuracy") @ApiOperation({ summary: "How accurate past campaigns' pre-launch forecasts turned out to be, once completed" })
  forecastAccuracy(@CurrentUser() user: AuthUser) { return this.svc.forecastAccuracy(user.id); }

  @Post("assistant") @ApiOperation({ summary: "Ask the AI Marketing Orchestrator about your real spend, leads and campaign performance" })
  ask(@CurrentUser() user: AuthUser, @Body() dto: AssistantAskDto) { return this.assistant.ask(user.id, dto.message, dto.history ?? []); }

  @Post("recommendations/:recId/resolve") @ApiOperation({ summary: "Approve, reject or dismiss an AI recommendation (never applies a change on its own)" })
  resolveRecommendation(@CurrentUser() user: AuthUser, @Param("recId") recId: string, @Body() dto: ResolveRecommendationDto) {
    return this.svc.resolveRecommendation(user.id, recId, dto.status);
  }

  @Post() @ApiOperation({ summary: "Build a campaign: targeting, creatives and a forecast" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) { return this.svc.create(user.id, dto); }

  @Post("suggest-audience") @ApiOperation({ summary: "Describe the buyer in plain words; get back a reviewable goal, budget and a few real localities" })
  suggestAudience(@CurrentUser() user: AuthUser, @Body() dto: SuggestAudienceDto) { return this.svc.suggestAudience(user.id, dto); }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.get(user.id, id); }

  @Get(":id/insights") @ApiOperation({ summary: "AI alerts, suggestions and a forecast built from this campaign's real numbers" })
  insights(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.insights(user.id, id); }

  @Patch(":id/media") @ApiOperation({ summary: "Add photos/video to a listing-less campaign still in draft" })
  media(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: MediaDto) { return this.svc.addMedia(user.id, id, dto.mediaIds); }

  @Patch(":id/creatives") @ApiOperation({ summary: "Save my edits to the ad text (live preview)" })
  creatives(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CreativesDto) { return this.svc.updateCreatives(user.id, id, dto); }

  @Patch(":id") @ApiOperation({ summary: "Rename a campaign before it's sent for review" })
  rename(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: RenameDto) { return this.svc.rename(user.id, id, dto.name); }

  @Delete(":id") @ApiOperation({ summary: "Delete a draft or rejected campaign" })
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.remove(user.id, id); }

  @Post(":id/podcast") @ApiOperation({ summary: "Make (or remake) the campaign's audio podcast ad" })
  podcast(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("regenerate") regenerate?: string) { return this.svc.podcast(user.id, id, regenerate === "1"); }

  @Post(":id/evolution") @ApiOperation({ summary: "AI Campaign Evolution: analyse this campaign's own real data and propose redesign versions" })
  analyseEvolution(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.evolution.analyse(user.id, id); }

  @Get(":id/evolution") @ApiOperation({ summary: "Past AI Campaign Evolution analyses for this campaign" })
  listEvolutions(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.evolution.list(user.id, id); }

  @Get(":id/evolution/:evoId")
  getEvolution(@CurrentUser() user: AuthUser, @Param("evoId") evoId: string) { return this.evolution.get(user.id, evoId); }

  @Post(":id/evolution/:evoId/changes/:changeId/resolve") @ApiOperation({ summary: "Approve or reject one proposed change (doesn't touch the live campaign)" })
  resolveEvolutionChange(@CurrentUser() user: AuthUser, @Param("evoId") evoId: string, @Param("changeId") changeId: string, @Body() dto: ResolveEvolutionChangeDto) {
    return this.evolution.resolveChange(user.id, evoId, changeId, dto.status);
  }

  @Post(":id/evolution/:evoId/versions/:versionId/apply") @ApiOperation({ summary: "Turn the approved changes in one version into a new draft campaign (never overwrites the live one)" })
  applyEvolutionVersion(@CurrentUser() user: AuthUser, @Param("evoId") evoId: string, @Param("versionId") versionId: string) {
    return this.evolution.applyVersion(user.id, evoId, versionId);
  }

  @Get(":id/evolution/:evoId/outcome") @ApiOperation({ summary: "Compares the original campaign against the applied variant, once both have run enough to say anything honestly" })
  evolutionOutcome(@CurrentUser() user: AuthUser, @Param("evoId") evoId: string) { return this.evolution.outcome(user.id, evoId); }

  @Get(":id/evolution/:evoId/experiment") @ApiOperation({ summary: "The formal A/B experiment report: hypothesis, control/variant stats, and a real statistical significance test on qualified conversion rate" })
  evolutionExperiment(@CurrentUser() user: AuthUser, @Param("evoId") evoId: string) { return this.evolution.experiment(user.id, evoId); }
}
