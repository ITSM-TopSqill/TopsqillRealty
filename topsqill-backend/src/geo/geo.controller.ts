import { Controller, Get, Query, BadRequestException } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { GeoService } from "./geo.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

@ApiTags("geo")
@Controller("v1/geo")
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get("search") @ApiOperation({ summary: "Find a building, society, street or locality in India" })
  search(@CurrentUser() user: AuthUser, @Query("q") q = "", @Query("near") near?: string) { return this.geo.search(user.id, q.slice(0, 160), near?.slice(0, 80)); }

  @Get("reverse") @ApiOperation({ summary: "The locality and city at a point on the map" })
  reverse(@CurrentUser() user: AuthUser, @Query("lat") lat: string, @Query("lng") lng: string) {
    const a = Number(lat), b = Number(lng);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new BadRequestException("Give a latitude and longitude.");
    return this.geo.reverse(user.id, a, b);
  }
}
