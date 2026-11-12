import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Min, MaxLength, IsArray, ArrayMaxSize } from "class-validator";
import { CampaignsService } from "./campaigns.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class CreateCampaignDto {
  @IsString() listingId: string;
  @IsInt() @Min(5000) budgetInr: number;
  @IsOptional() @IsInt() @Min(3) days?: number;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsString() @MaxLength(400) notes?: string;
}
class StatusDto { @IsIn(["active", "paused", "completed"]) status: "active" | "paused" | "completed"; }

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
  constructor(private readonly svc: CampaignsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) { return this.svc.list(user.id); }

  @Post() @ApiOperation({ summary: "Build a campaign: targeting, creatives and a forecast" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) { return this.svc.create(user.id, dto); }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.get(user.id, id); }

  @Patch(":id/creatives") @ApiOperation({ summary: "Save my edits to the ad text (live preview)" })
  creatives(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CreativesDto) { return this.svc.updateCreatives(user.id, id, dto); }

  @Post(":id/podcast") @ApiOperation({ summary: "Make (or remake) the campaign's audio podcast ad" })
  podcast(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("regenerate") regenerate?: string) { return this.svc.podcast(user.id, id, regenerate === "1"); }

  @Post(":id/launch")
  launch(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.launch(user.id, id); }

  @Post(":id/status")
  status(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: StatusDto) {
    return this.svc.setStatus(user.id, id, dto.status);
  }
}
