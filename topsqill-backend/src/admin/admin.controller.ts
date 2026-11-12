import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { IsOptional, IsString, IsIn, IsBoolean, IsInt, IsArray, ArrayMaxSize } from "class-validator";
import { Type } from "class-transformer";
import { AdminService } from "./admin.service";
import { AdminGuard } from "../auth/jwt.guard";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

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
  constructor(private readonly svc: AdminService) {}

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
