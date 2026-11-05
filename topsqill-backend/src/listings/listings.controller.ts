import { Body, Controller, Get, Param, Patch, Post, Query, Header } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsOptional, IsString, IsInt, IsIn, Min, Max, IsArray, MaxLength } from "class-validator";
import { Type } from "class-transformer";
import { ListingsService } from "./listings.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

class SearchDto {
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() locality?: string;
  @IsOptional() @IsIn(["sale", "rent"]) purpose?: "sale" | "rent";
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10) bhk?: number;
  @IsOptional() @Type(() => Number) @IsInt() minPrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() maxPrice?: number;
  @IsOptional() @IsString() possession?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class CreateListingDto {
  @IsString() @MaxLength(140) title: string;
  @IsIn(["sale", "rent"]) purpose: "sale" | "rent";
  @IsString() kind: string;
  @IsString() city: string;
  @IsString() locality: string;
  @IsOptional() @IsInt() bhk?: number;
  @IsOptional() @IsInt() areaSqft?: number;
  @IsOptional() @IsInt() priceInr?: number;
  @IsOptional() @IsString() possession?: string;
  @IsOptional() @IsString() furnishing?: string;
  @IsOptional() @IsString() facing?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() amenities?: string[];
  @IsOptional() @IsArray() usps?: string[];
  @IsOptional() @IsArray() mediaIds?: string[];
}

@ApiTags("listings")
@Controller("v1/listings")
export class ListingsController {
  constructor(private readonly svc: ListingsService) {}

  /** Public search. The CDN may hold this for 30 seconds, which absorbs traffic spikes. */
  @Public() @Get() @Header("cache-control", "public, max-age=15, s-maxage=30, stale-while-revalidate=120")
  @ApiOperation({ summary: "Search listings" })
  search(@Query() q: SearchDto) { return this.svc.search(q); }

  @Public() @Get(":id") @Header("cache-control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300")
  getOne(@Param("id") id: string) { return this.svc.getById(id); }

  @Post() @ApiOperation({ summary: "Publish a listing" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto) { return this.svc.create(user.id, dto as any); }

  @Patch(":id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: Partial<CreateListingDto>) {
    return this.svc.update(user.id, id, dto as any);
  }

  @Public() @Post(":id/view")
  view(@Param("id") id: string) { return this.svc.recordView(id); }
}
