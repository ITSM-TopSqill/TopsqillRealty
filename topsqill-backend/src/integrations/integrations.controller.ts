import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsArray, MaxLength } from "class-validator";
import { AdPlatformsService } from "./ad-platforms.service";
import { WhatsAppService } from "./whatsapp.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

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
class OptInDto {
  @IsString() phone: string;
  @IsIn(["lead form", "chat", "manual", "website"]) source: string;
  @IsOptional() @IsString() proof?: string;
}

@ApiTags("integrations")
@Controller("v1")
export class IntegrationsController {
  constructor(private readonly ads: AdPlatformsService, private readonly wa: WhatsAppService) {}

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
    return mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN ? challenge : { ok: false };
  }

  @Public() @Post("whatsapp/webhook")
  webhook(@Body() body: Record<string, unknown>) { return this.wa.handleWebhook(null, body); }
}
