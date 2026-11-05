import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsInt, MaxLength, IsBoolean } from "class-validator";
import { LeadsService, Stage } from "./leads.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class CreateLeadDto {
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() sourceDetail?: string;
  @IsOptional() @IsString() listingId?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() locality?: string;
  @IsOptional() @IsInt() budgetMin?: number;
  @IsOptional() @IsInt() budgetMax?: number;
  @IsOptional() @IsString() timeline?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() otpVerified?: boolean;
}
class StageDto { @IsIn(["new", "contacted", "site_visit", "negotiation", "booked", "lost"]) stage: Stage; }
class NoteDto {
  @IsString() @MaxLength(2000) body: string;
  @IsOptional() @IsIn(["note", "call", "whatsapp", "email", "visit"]) kind?: string;
}
class AssignDto { @IsString() assigneeId: string; }

@ApiTags("leads")
@Controller("v1/leads")
export class LeadsController {
  constructor(private readonly svc: LeadsService) {}

  @Get() @ApiOperation({ summary: "My CRM board, grouped by stage" })
  board(@CurrentUser() user: AuthUser, @Query("assignee") assignee?: string) {
    return this.svc.board(user.id, assignee);
  }

  @Get("stats")
  stats(@CurrentUser() user: AuthUser) { return this.svc.stats(user.id); }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.get(user.id, id); }

  @Post() @ApiOperation({ summary: "Add a lead by hand" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeadDto) {
    return this.svc.capture(user.id, { ...dto, source: dto.source ?? "manual" });
  }

  @Post(":id/stage")
  stage(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: StageDto) {
    return this.svc.setStage(user.id, id, dto.stage);
  }

  @Post(":id/assign")
  assign(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AssignDto) {
    return this.svc.assign(user.id, id, dto.assigneeId);
  }

  @Post(":id/activity")
  note(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: NoteDto) {
    return this.svc.note(user.id, id, dto.body, dto.kind);
  }
}
