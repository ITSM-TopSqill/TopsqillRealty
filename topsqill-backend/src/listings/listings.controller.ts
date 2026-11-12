import { Body, Controller, Get, Param, Patch, Post, Query, Header } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsOptional, IsString, IsInt, IsIn, Min, Max, IsArray, MaxLength, IsNumber } from "class-validator";
import { IsBoolean } from "class-validator";
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
  /** One member's listings, for their profile. */
  @IsOptional() @IsString() ownerId?: string;
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
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number | null;
  @IsOptional() @IsBoolean() locationExact?: boolean;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number | null;
  /** YouTube or Vimeo; anything else is refused. */
  @IsOptional() @IsString() @MaxLength(500) videoUrl?: string;
  /** Matterport, Kuula, Momento360, CloudPano or a 360° YouTube video. */
  @IsOptional() @IsString() @MaxLength(500) tourUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) sourceUrl?: string;
  @IsOptional() @IsString() @MaxLength(64) reraNumber?: string;
}

/**
 * Every field is optional, and each is declared here so the validation pipe can
 * strip anything else. A bare `Partial<CreateListingDto>` type is erased at
 * runtime, which let any column (verified, hidden, ownerId...) through.
 */
class UpdateListingDto {
  @IsOptional() @IsString() @MaxLength(140) title?: string;
  @IsOptional() @IsIn(["sale", "rent"]) purpose?: "sale" | "rent";
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() locality?: string;
  @IsOptional() @IsInt() bhk?: number;
  @IsOptional() @IsInt() areaSqft?: number;
  @IsOptional() @IsInt() priceInr?: number;
  @IsOptional() @IsString() possession?: string;
  @IsOptional() @IsString() furnishing?: string;
  @IsOptional() @IsString() facing?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() amenities?: string[];
  @IsOptional() @IsArray() usps?: string[];
  @IsOptional() @IsIn(["active", "sold", "archived"]) status?: "active" | "sold" | "archived";
  /** The full photo list, in order; replaces the old one. The first is the cover. */
  @IsOptional() @IsArray() @IsString({ each: true }) mediaIds?: string[];
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number | null;
  @IsOptional() @IsBoolean() locationExact?: boolean;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number | null;
  @IsOptional() @IsString() @MaxLength(500) videoUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) tourUrl?: string;
  @IsOptional() @IsString() @MaxLength(64) reraNumber?: string;
}

@ApiTags("listings")
@Controller("v1/listings")
export class ListingsController {
  constructor(private readonly svc: ListingsService) {}

  /** Public search. The CDN may hold this for 30 seconds, which absorbs traffic spikes. */
  @Public() @Get() @Header("cache-control", "public, max-age=15, s-maxage=30, stale-while-revalidate=120")
  @ApiOperation({ summary: "Search listings" })
  search(@Query() q: SearchDto) { return this.svc.search(q); }

  /** My own listings, in every state, for the campaign studio and my profile tools. */
  @Get("mine")
  mine(@CurrentUser() user: AuthUser) { return this.svc.mine(user.id); }

  @Get(":id/edit") @ApiOperation({ summary: "My listing, with everything the edit screen needs" })
  forEdit(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.forEdit(user.id, id); }

  @Public() @Get(":id/price-trend") @ApiOperation({ summary: "Locality and city prices over 12 months, next to this listing" })
  priceTrend(@Param("id") id: string) { return this.svc.priceTrend(id); }

  @Public() @Get(":id") @Header("cache-control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300")
  getOne(@Param("id") id: string) { return this.svc.getById(id); }

  @Post() @ApiOperation({ summary: "Publish a listing" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto) { return this.svc.create(user.id, dto as any); }

  @Patch(":id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UpdateListingDto) {
    return this.svc.update(user.id, id, dto);
  }

  @Public() @Post(":id/view")
  view(@Param("id") id: string) { return this.svc.recordView(id); }
}
