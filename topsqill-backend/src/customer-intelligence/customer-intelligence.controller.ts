import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsString, MaxLength, IsObject, IsIn, IsOptional } from "class-validator";
import { CustomerIntelligenceService } from "./customer-intelligence.service";
import type { SegmentDefinition } from "./differentiators";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class DescribeDto { @IsString() @MaxLength(800) description: string; }

class CreateSegmentDto {
  @IsString() @MaxLength(160) name: string;
  @IsObject() definition: SegmentDefinition;
  @IsOptional() @IsIn(["manual", "ai"]) source?: "manual" | "ai";
}

/**
 * Universal Customer Differentiator Engine + Audience Builder (Part 4-5),
 * Workstream 2: a real-data CRM segment builder over Topsqill's own leads.
 * Never pushes anything to an ad platform - see differentiators.ts.
 */
@ApiTags("customer-intelligence")
@Controller("v1/customer-intelligence")
export class CustomerIntelligenceController {
  constructor(private readonly svc: CustomerIntelligenceService) {}

  @Get("differentiators") @ApiOperation({ summary: "The full differentiator catalog - every real signal segments can be built from" })
  differentiators() { return this.svc.differentiators(); }

  @Post("segments/describe") @ApiOperation({ summary: "Turn a free-text customer description into reviewable segment conditions (saves nothing)" })
  describe(@CurrentUser() user: AuthUser, @Body() dto: DescribeDto) { return this.svc.draftFromDescription(user.id, dto.description); }

  @Post("segments") @ApiOperation({ summary: "Save a CRM segment (AND/OR/NOT conditions over real leads)" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSegmentDto) { return this.svc.create(user.id, dto.name, dto.definition, dto.source); }

  @Get("segments")
  list(@CurrentUser() user: AuthUser) { return this.svc.list(user.id); }

  @Get("segments/:id") @ApiOperation({ summary: "A segment with a live match count and sample leads" })
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.get(user.id, id); }

  @Delete("segments/:id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.remove(user.id, id); }
}
