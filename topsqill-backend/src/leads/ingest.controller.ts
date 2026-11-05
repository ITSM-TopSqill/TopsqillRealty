import { Body, Controller, Get, Param, Post, Query, Req, Res, Header } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { IngestService } from "./ingest.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

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
   * so no sign-in is needed, and Meta's signature is checked when configured.
   */
  @Public() @Post("ingest/:source/:key") @Header("cache-control", "no-store")
  async ingest(@Param("source") source: string, @Param("key") key: string, @Body() body: Record<string, unknown>, @Req() req: any) {
    if (source === "meta") {
      const ok = this.svc.verifyMetaSignature(req.rawBody ?? Buffer.from(JSON.stringify(body ?? {})), req.headers["x-hub-signature-256"], process.env.META_APP_SECRET);
      if (!ok) return { ok: false, error: "bad signature" };
    }
    return this.svc.handle(source, key, body ?? {});
  }
}
