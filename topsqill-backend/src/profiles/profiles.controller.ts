import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsOptional, IsString, IsIn, IsArray, IsInt, MaxLength, ArrayMaxSize } from "class-validator";
import { ProfilesService } from "./profiles.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

class UpdateMeDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(["buyer", "seller", "dealer", "builder"]) type?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) localities?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) specialties?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) interests?: string[];
  @IsOptional() @IsString() @MaxLength(160) headline?: string;
  @IsOptional() @IsString() about?: string;
  @IsOptional() @IsString() agency?: string;
  @IsOptional() @IsInt() yearsExperience?: number;
  @IsOptional() @IsString() reraNumber?: string;
  @IsOptional() @IsString() avatarMediaId?: string;
  @IsOptional() @IsString() coverMediaId?: string;
  @IsOptional() @IsString() email?: string;
}

@ApiTags("profiles")
@Controller("v1")
export class ProfilesController {
  constructor(private readonly svc: ProfilesService) {}

  @Get("me") @ApiOperation({ summary: "My profile" })
  async me(@CurrentUser() user: AuthUser) { return { ...(await this.svc.getProfile(user.id, user.id)), demo: !!user.demo }; }

  @Patch("me")
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) { return this.svc.updateMe(user.id, dto as any); }

  @Get("me/stats") @ApiOperation({ summary: "My profile strength, profile viewers and listing views" })
  stats(@CurrentUser() user: AuthUser) { return this.svc.myStats(user.id); }

  @Post("profiles/:id/view") @ApiOperation({ summary: "Count my visit to this profile (once a day)" })
  view(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.recordView(user.id, id); }

  @Public() @Get("profiles/:id")
  get(@Param("id") id: string, @CurrentUser() user?: AuthUser) { return this.svc.getProfile(id, user?.id); }

  @Post("profiles/:id/connect")
  connect(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.connect(user.id, id); }

  @Post("profiles/:id/accept")
  accept(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.respond(user.id, id, true); }

  @Post("profiles/:id/ignore")
  ignore(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.respond(user.id, id, false); }

  @Get("connections")
  list(@CurrentUser() user: AuthUser, @Query("status") status?: string, @Query("limit") limit?: string) {
    return this.svc.listConnections(user.id, status === "pending" || status === "sent" ? status : "accepted", Math.min(Math.max(Number(limit) || 30, 1), 100));
  }

  @Get("connections/suggestions") @ApiOperation({ summary: "People you may know" })
  suggestions(@CurrentUser() user: AuthUser) { return this.svc.suggestions(user.id); }
}
