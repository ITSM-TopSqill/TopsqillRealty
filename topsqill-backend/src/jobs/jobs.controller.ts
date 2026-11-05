import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, IsArray, IsBoolean, MaxLength, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { JobsService, JOB_CATEGORIES } from "./jobs.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

class DraftDto {
  @IsString() @MaxLength(600) request: string;
  @IsOptional() @IsString() company?: string;
  @IsString() city: string;
}
class CreateJobDto {
  @IsString() @MaxLength(120) title: string;
  @IsIn(JOB_CATEGORIES as unknown as string[]) category: string;
  @IsString() city: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() locality?: string;
  @IsOptional() @IsString() employment?: string;
  @IsOptional() @IsString() workMode?: string;
  @IsOptional() @IsInt() openings?: number;
  @IsOptional() @IsInt() expMin?: number;
  @IsOptional() @IsInt() expMax?: number;
  @IsOptional() salaryMin?: number;
  @IsOptional() salaryMax?: number;
  @IsOptional() @IsBoolean() incentives?: boolean;
  @IsOptional() @IsArray() skills?: string[];
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsArray() responsibilities?: string[];
  @IsOptional() @IsArray() requirements?: string[];
}
class ApplyDto {
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsInt() yearsExperience?: number;
  @IsOptional() @IsString() noticePeriod?: string;
}
class ListDto {
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
class AppStatusDto { @IsIn(["viewed", "shortlisted", "rejected", "hired"]) status: "viewed" | "shortlisted" | "rejected" | "hired"; }

@ApiTags("jobs")
@Controller("v1/jobs")
export class JobsController {
  constructor(private readonly svc: JobsService) {}

  @Public() @Get() @ApiOperation({ summary: "Search real estate jobs" })
  list(@Query() q: ListDto) { return this.svc.list(q); }

  @Get("applications/mine")
  mine(@CurrentUser() user: AuthUser) { return this.svc.myApplications(user.id); }

  @Public() @Get(":id")
  get(@Param("id") id: string) { return this.svc.get(id); }

  @Post("draft") @ApiOperation({ summary: "Write a job post from one line" })
  draft(@CurrentUser() user: AuthUser, @Body() dto: DraftDto) {
    return this.svc.draft(user.id, dto.request, dto.company ?? "Our company", dto.city);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobDto) { return this.svc.create(user.id, dto as never); }

  @Get(":id/fit") @ApiOperation({ summary: "How well I match this role" })
  fit(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.fit(user.id, id); }

  @Post(":id/apply")
  apply(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: ApplyDto) { return this.svc.apply(user.id, id, dto); }

  @Get(":id/applicants")
  applicants(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.applicants(user.id, id); }

  @Post("applications/:id/status")
  status(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AppStatusDto) {
    return this.svc.setApplicationStatus(user.id, id, dto.status);
  }
}
