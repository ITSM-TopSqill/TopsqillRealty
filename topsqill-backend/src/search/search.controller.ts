import { Controller, Get, Query, Header } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsOptional, IsString, IsInt, Min, Max, MaxLength, IsIn } from "class-validator";
import { Type } from "class-transformer";
import { SearchService } from "./search.service";
import { Public } from "../auth/public.decorator";

class SuggestDto {
  @IsString() @MaxLength(80) q: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) limit?: number;
  /** Just one kind of result, for the tabs on the search page. */
  @IsOptional() @IsIn(["people", "listings", "localities", "jobs"]) only?: "people" | "listings" | "localities" | "jobs";
}
class LocalityDto {
  @IsString() @MaxLength(80) locality: string;
  @IsOptional() @IsString() city?: string;
}

@ApiTags("search")
@Controller("v1/search")
export class SearchController {
  constructor(private readonly svc: SearchService) {}

  @Public() @Get() @Header("cache-control", "public, max-age=30, s-maxage=60")
  @ApiOperation({ summary: "Search people, listings and localities" })
  suggest(@Query() q: SuggestDto) { return this.svc.suggest(q.q, q.limit, q.only); }

  @Public() @Get("locality") @Header("cache-control", "public, max-age=300, s-maxage=600")
  locality(@Query() q: LocalityDto) { return this.svc.localityStats(q.locality, q.city); }
}
