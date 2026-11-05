import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Min, MaxLength } from "class-validator";
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

  @Post(":id/launch")
  launch(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.launch(user.id, id); }

  @Post(":id/status")
  status(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: StatusDto) {
    return this.svc.setStatus(user.id, id, dto.status);
  }
}
