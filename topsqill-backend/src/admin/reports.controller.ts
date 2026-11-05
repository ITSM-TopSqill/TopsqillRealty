import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { AdminService } from "./admin.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class ReportDto {
  @IsIn(["post", "comment", "listing", "profile"]) targetType: string;
  @IsString() targetId: string;
  @IsString() @MaxLength(60) reason: string;
  @IsOptional() @IsString() @MaxLength(1000) detail?: string;
}

/** Members report content here; it then appears in the admin queue. */
@ApiTags("reports")
@Controller("v1/reports")
export class ReportsController {
  constructor(private readonly svc: AdminService) {}

  @Post() @ApiOperation({ summary: "Report a post, listing or member" })
  report(@CurrentUser() user: AuthUser, @Body() dto: ReportDto) { return this.svc.createReport(user.id, dto); }
}
