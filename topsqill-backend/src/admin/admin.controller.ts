import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { IsOptional, IsString, IsIn, IsBoolean, IsInt, IsArray, ArrayMaxSize, MaxLength } from "class-validator";
import { Type } from "class-transformer";
import { AdminService } from "./admin.service";
import { ListingReviewService } from "../listings/review.service";
import { AdminGuard } from "../auth/jwt.guard";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class ListingDecisionDto {
  @IsIn(["approved", "changes", "rejected"]) decision: "approved" | "changes" | "rejected";
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) reasons?: string[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
class ListingApprovalDto { @IsIn(["all", "unverified", "off"]) approval: "all" | "unverified" | "off"; }
class DecideDto {
  @IsIn(["approved", "rejected", "info"]) decision: "approved" | "rejected" | "info";
  @IsOptional() @IsString() note?: string;
}
class ModerateDto {
  @IsIn(["post", "comment", "listing"]) targetType: string;
  @IsString() targetId: string;
  @IsBoolean() hide: boolean;
  @IsOptional() @IsString() reason?: string;
}
class MembersDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() offset?: number;
}
class StatusDto {
  @IsIn(["active", "suspended", "removed"]) status: "active" | "suspended" | "removed";
  @IsOptional() @IsString() reason?: string;
}

class AiSettingsDto {
  @IsBoolean() enabled: boolean;
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) disabled: string[];
  @IsOptional() @IsString() model?: string | null;
}

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(AdminGuard)          // every route here is admin-only
@Controller("v1/admin")
export class AdminController {
  constructor(private readonly svc: AdminService, private readonly reviews: ListingReviewService) {}

  /* ----------------------------- listing review ----------------------------- */

  @Get("listings") @ApiOperation({ summary: "Listings waiting for review (or decided), with checks" })
  listingQueue(@Query("status") status?: string) {
    const s = ["pending", "changes", "rejected", "approved"].includes(status ?? "") ? status as "pending" : "pending";
    return this.reviews.queueFor(s);
  }

  @Post("listings/:id/decide") @ApiOperation({ summary: "Approve, ask for changes, or reject a listing (the owner is told why)" })
  decideListing(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: ListingDecisionDto) {
    return this.reviews.decide(user.id, id, dto);
  }

  @Get("listings/settings")
  async listingSettings() { return { approval: await this.reviews.mode() }; }

  @Post("listings/settings") @ApiOperation({ summary: "Which listings need approval: all, unverified members only, or none" })
  saveListingSettings(@CurrentUser() user: AuthUser, @Body() dto: ListingApprovalDto) { return this.reviews.setMode(user.id, dto.approval); }

  @Get("overview") @ApiOperation({ summary: "Numbers for the admin dashboard" })
  overview() { return this.svc.overview(); }

  @Get("ai") @ApiOperation({ summary: "AI usage by feature, and whether AI is configured" })
  ai() { return this.svc.aiUsage(); }

  @Post("scraper/reload") @ApiOperation({ summary: "Re-read the api.sh keys now and forget which ones failed" })
  reloadScraperKeys(@CurrentUser() user: AuthUser) { return this.svc.reloadScraperKeys(user.id); }

  @Get("connectors") @ApiOperation({ summary: "Every outside service and whether it is set up (never secret values)" })
  connectors() { return this.svc.connectors(); }

  @Get("ai/settings") @ApiOperation({ summary: "AI on/off, per feature, and the model" })
  aiSettings() { return this.svc.aiSettings(); }

  @Post("ai/settings")
  saveAiSettings(@CurrentUser() user: AuthUser, @Body() dto: AiSettingsDto) { return this.svc.saveAiSettings(user.id, dto); }

  @Get("ai/brief") @ApiOperation({ summary: "Today's AI-written brief for the admin" })
  brief(@CurrentUser() user: AuthUser, @Query("refresh") refresh?: string) { return this.svc.aiBrief(user.id, refresh === "1"); }

  @Get("verifications")
  queue(@Query("status") status?: string) { return this.svc.verificationQueue(status ?? "pending"); }

  @Get("verifications/:id/documents") @ApiOperation({ summary: "Short-lived links to the documents" })
  documents(@Param("id") id: string) { return this.svc.verificationDocuments(id); }

  @Post("verifications/:id/review") @ApiOperation({ summary: "Run the automatic risk checks" })
  review(@Param("id") id: string) { return this.svc.riskCheck(id); }

  @Post("verifications/:id/decide")
  decide(@CurrentUser() admin: AuthUser, @Param("id") id: string, @Body() dto: DecideDto) {
    return this.svc.decide(admin.id, id, dto.decision, dto.note);
  }

  @Get("reports")
  reports(@Query("status") status?: "open" | "actioned" | "dismissed") { return this.svc.reportQueue(status ?? "open"); }

  @Post("moderate")
  moderate(@CurrentUser() admin: AuthUser, @Body() dto: ModerateDto) {
    return this.svc.moderate(admin.id, dto.targetType, dto.targetId, dto.hide, dto.reason);
  }

  @Get("members")
  members(@Query() q: MembersDto) { return this.svc.members(q); }

  @Post("members/:id/status")
  setStatus(@CurrentUser() admin: AuthUser, @Param("id") id: string, @Body() dto: StatusDto) {
    return this.svc.setMemberStatus(admin.id, id, dto.status, dto.reason);
  }

  @Post("members/:id/verify/:field")
  verify(@CurrentUser() admin: AuthUser, @Param("id") id: string, @Param("field") field: "kyc" | "rera", @Body() body: { value: boolean }) {
    return this.svc.setVerified(admin.id, id, field, body?.value !== false);
  }

  @Get("audit")
  audit() { return this.svc.auditTrail(); }
}
