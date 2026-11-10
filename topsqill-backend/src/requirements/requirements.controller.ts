import { Body, Controller, Get, Param, Post, Query, Delete, Patch } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsOptional, IsString, IsInt, IsIn, IsArray, IsBoolean, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { RequirementsService } from "./requirements.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

class CreateRequirementDto {
  @IsIn(["sale", "rent"]) purpose: "sale" | "rent";
  @IsString() city: string;
  @IsArray() localities: string[];
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10) bhk?: number;
  @IsOptional() @IsInt() minPrice?: number;
  @IsOptional() @IsInt() maxPrice?: number;
  @IsOptional() @IsInt() minArea?: number;
  @IsOptional() @IsString() timeline?: string;
  @IsOptional() @IsBoolean() needsLoan?: boolean;
  @IsOptional() @IsString() note?: string;
}
class UpdateRequirementDto {
  @IsOptional() @IsIn(["sale", "rent"]) purpose?: "sale" | "rent";
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) localities?: string[];
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10) bhk?: number | null;
  @IsOptional() @IsInt() minPrice?: number | null;
  @IsOptional() @IsInt() maxPrice?: number | null;
  @IsOptional() @IsInt() minArea?: number | null;
  @IsOptional() @IsString() timeline?: string;
  @IsOptional() @IsBoolean() needsLoan?: boolean;
  @IsOptional() @IsString() note?: string | null;
  /** Reopen a closed requirement. Closing is DELETE. */
  @IsOptional() @IsIn(["active", "closed"]) status?: "active" | "closed";
}
class ListDto {
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsIn(["sale", "rent"]) purpose?: "sale" | "rent";
  @IsOptional() @Type(() => Number) @IsInt() bhk?: number;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@ApiTags("requirements")
@Controller("v1/requirements")
export class RequirementsController {
  constructor(private readonly svc: RequirementsService) {}

  @Public() @Get() @ApiOperation({ summary: "The requirements board" })
  list(@Query() q: ListDto) { return this.svc.list(q); }

  @Get("mine")
  mine(@CurrentUser() user: AuthUser) { return this.svc.mine(user.id); }

  @Post() @ApiOperation({ summary: "Post what you are looking for" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRequirementDto) { return this.svc.create(user.id, dto as any); }

  @Public() @Get(":id/matches") @ApiOperation({ summary: "Listings that match this requirement" })
  matches(@Param("id") id: string) { return this.svc.matches(id); }

  @Post(":id/rematch")
  rematch(@Param("id") id: string) { return this.svc.recompute(id); }

  @Patch(":id") @ApiOperation({ summary: "Edit my requirement (matches are found again)" })
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UpdateRequirementDto) { return this.svc.update(user.id, id, dto as Record<string, unknown>); }

  @Delete(":id")
  close(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.close(user.id, id); }
}
