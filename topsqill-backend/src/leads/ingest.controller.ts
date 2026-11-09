import { Body, Controller, Get, Param, Post, Query, Req, Header, UnauthorizedException, type RawBodyRequest } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { IngestService } from "./ingest.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";
import { verifyMetaSignature } from "../common/meta-signature";
import { env, isProd } from "../common/env";

class CreateSourceDto {
  @IsIn(["website", "meta", "google", "linkedin", "whatsapp", "portal_99acres", "portal_magicbricks", "portal_housing", "call", "other"])
  source: string;
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @IsIn(["owner", "round_robin", "locality"]) assignRule?: string;
}

@ApiTags("lead sources")
@Controller("v1")
export class IngestController {
  constructor(private readonly svc: IngestService) {}

  @Get("lead-sources") @ApiOperation({ summary: "My connected lead sources" })
  list(@CurrentUser() user: AuthUser) { return this.svc.listSources(user.id); }

  @Post("lead-sources") @ApiOperation({ summary: "Connect a source and get its webhook URL" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSourceDto) {
    return this.svc.createSource(user.id, dto.source, dto.name, {}, dto.assignRule ?? "owner");
  }

  @Get("lead-sources/:id/events")
  events(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.events(user.id, id); }

  /** Meta verifies a new webhook by calling it with a challenge. */
  @Public() @Get("ingest/meta/:key")
  verify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string, @Param("key") key: string) {
    if (mode === "subscribe" && token === key) return challenge;
    return { ok: false };
  }

  /**
   * One endpoint for every platform. The key in the URL identifies the member,
   * so no sign-in is needed. Meta's calls must carry a valid signature over the
   * raw body; in production they are refused until META_APP_SECRET is set.
   */
  @Public() @Post("ingest/:source/:key") @Header("cache-control", "no-store")
  async ingest(@Param("source") source: string, @Param("key") key: string, @Body() body: Record<string, unknown>, @Req() req: RawBodyRequest<{ headers: Record<string, string | string[] | undefined> }>) {
    if (source === "meta") {
      const check = verifyMetaSignature(req.rawBody, req.headers["x-hub-signature-256"], env.META_APP_SECRET, isProd());
      if (!check.ok) throw new UnauthorizedException(`Webhook rejected: ${check.reason}.`);
    }
    return this.svc.handle(source, key, body ?? {});
  }
}
