import { Body, Controller, Delete, Get, Param, Post, Query, Req, UnauthorizedException, type RawBodyRequest } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsArray, MaxLength, ArrayMaxSize, ArrayMinSize } from "class-validator";
import { AdPlatformsService } from "./ad-platforms.service";
import { WhatsAppService } from "./whatsapp.service";
import { MediaInboxService } from "./media-inbox.service";
import { InstagramService } from "./instagram.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";
import { verifyMetaSignature } from "../common/meta-signature";
import { env, isProd } from "../common/env";

class ConnectAdDto {
  @IsIn(["meta", "google", "linkedin"]) platform: "meta" | "google" | "linkedin";
  @IsString() accountId: string;
  @IsOptional() @IsString() accountName?: string;
  @IsString() token: string;
}
class ConnectWaDto {
  @IsString() wabaId: string;
  @IsString() phoneNumberId: string;
  @IsOptional() @IsString() displayNumber?: string;
  @IsString() token: string;
}
class SendWaDto {
  @IsString() to: string;
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @IsOptional() @IsString() template?: string;
  @IsOptional() @IsArray() templateParams?: string[];
  @IsOptional() @IsString() leadId?: string;
}
class IgCallbackDto { @IsString() @MaxLength(2000) code: string; @IsString() @MaxLength(200) state: string; }
class IgImportDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) ids: string[]; }
class OptInDto {
  @IsString() phone: string;
  @IsIn(["lead form", "chat", "manual", "website"]) source: string;
  @IsOptional() @IsString() proof?: string;
}

@ApiTags("integrations")
@Controller("v1")
export class IntegrationsController {
  constructor(
    private readonly ads: AdPlatformsService,
    private readonly wa: WhatsAppService,
    private readonly inbox: MediaInboxService,
    private readonly ig: InstagramService,
  ) {}

  /* ------------------- my own photos and videos: WhatsApp, Instagram ------------------- */

  @Get("whatsapp/inbox") @ApiOperation({ summary: "Topsqill's WhatsApp number that members send their photos and videos to" })
  async inboxInfo(@CurrentUser() user: AuthUser) {
    return { configured: this.inbox.configured, number: await this.inbox.number(), myPhone: await this.inbox.phoneOf(user.id) };
  }

  @Get("instagram/status")
  igStatus(@CurrentUser() user: AuthUser) { return this.ig.status(user.id); }

  @Get("instagram/authorize") @ApiOperation({ summary: "The Instagram login link to connect my account" })
  igAuthorize(@CurrentUser() user: AuthUser) { return this.ig.authorizeUrl(user.id); }

  @Post("instagram/callback") @ApiOperation({ summary: "Finish connecting Instagram (called by the website after Instagram's login)" })
  igCallback(@CurrentUser() user: AuthUser, @Body() dto: IgCallbackDto) { return this.ig.connect(user.id, dto.code, dto.state); }

  @Delete("instagram")
  igDisconnect(@CurrentUser() user: AuthUser) { return this.ig.disconnect(user.id); }

  @Get("instagram/media") @ApiOperation({ summary: "My Instagram posts and reels, to pick from" })
  igMedia(@CurrentUser() user: AuthUser, @Query("after") after?: string) { return this.ig.media(user.id, after); }

  @Post("instagram/import") @ApiOperation({ summary: "Copy picked Instagram photos and videos into my Topsqill media" })
  igImport(@CurrentUser() user: AuthUser, @Body() dto: IgImportDto) { return this.ig.import(user.id, dto.ids); }

  /* ------------------------------ ad accounts ------------------------------ */

  @Get("ad-accounts")
  listAds(@CurrentUser() user: AuthUser) { return this.ads.listAccounts(user.id); }

  @Post("ad-accounts") @ApiOperation({ summary: "Connect a Meta, Google or LinkedIn ad account" })
  connectAd(@CurrentUser() user: AuthUser, @Body() dto: ConnectAdDto) {
    return this.ads.connect(user.id, dto.platform, dto.accountId, dto.accountName ?? dto.accountId, dto.token);
  }

  @Delete("ad-accounts/:id")
  disconnect(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ads.disconnect(user.id, id); }

  @Post("campaigns/:id/launch-live") @ApiOperation({ summary: "Create the campaign on the ad platforms" })
  launch(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ads.launch(user.id, id); }

  @Get("campaigns/:id/deliveries")
  deliveries(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.ads.deliveries(user.id, id); }

  /* -------------------------------- whatsapp -------------------------------- */

  @Get("whatsapp/account")
  waAccount(@CurrentUser() user: AuthUser) { return this.wa.account(user.id); }

  @Post("whatsapp/connect")
  connectWa(@CurrentUser() user: AuthUser, @Body() dto: ConnectWaDto) { return this.wa.connect(user.id, dto); }

  @Post("whatsapp/opt-in")
  optIn(@CurrentUser() user: AuthUser, @Body() dto: OptInDto) { return this.wa.recordOptIn(user.id, dto.phone, dto.source, dto.proof); }

  @Post("whatsapp/send")
  send(@CurrentUser() user: AuthUser, @Body() dto: SendWaDto) { return this.wa.send(user.id, dto); }

  @Get("whatsapp/history/:leadId")
  history(@CurrentUser() user: AuthUser, @Param("leadId") leadId: string) { return this.wa.history(user.id, leadId); }

  /** Meta verifies the webhook once with a challenge. */
  @Public() @Get("whatsapp/webhook")
  verify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string) {
    // An unset token must never match a request that simply omits it.
    const expected = env.WHATSAPP_VERIFY_TOKEN;
    return mode === "subscribe" && !!expected && token === expected ? challenge : { ok: false };
  }

  /**
   * Incoming messages and delivery statuses. Anyone on the internet can reach
   * this URL, so only calls signed by Meta are processed: an unsigned call
   * could otherwise create leads and record WhatsApp consent for any number.
   */
  @Public() @Post("whatsapp/webhook")
  webhook(@Body() body: Record<string, unknown>, @Req() req: RawBodyRequest<{ headers: Record<string, string | string[] | undefined> }>) {
    const check = verifyMetaSignature(req.rawBody, req.headers["x-hub-signature-256"], env.META_APP_SECRET, isProd());
    if (!check.ok) throw new UnauthorizedException(`Webhook rejected: ${check.reason}.`);
    // Messages to Topsqill's own number are members sending their photos and videos.
    const value = (body as any)?.entry?.[0]?.changes?.[0]?.value;
    if (value && this.inbox.isOurNumber(value.metadata?.phone_number_id)) return this.inbox.receive(value);
    return this.wa.handleWebhook(null, body);
  }
}
