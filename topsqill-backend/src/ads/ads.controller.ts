import { Body, Controller, ForbiddenException, Get, Header, Param, Post, Query, Req, UseGuards, type RawBodyRequest } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ArrayMaxSize, ValidateNested } from "class-validator";
import { AdsService } from "./ads.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";
import { AdminGuard } from "../auth/jwt.guard";
import { verifyMetaSignature } from "../common/meta-signature";
import { env, isProd } from "../common/env";

class BillingDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(15) gstin?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(2) stateCode?: string;
}
class TopupDto {
  @IsInt() @Min(100) @Max(1_000_000) amountInr: number;
  @IsOptional() @ValidateNested() @Type(() => BillingDto) billing?: BillingDto;
}
class ConfirmDto {
  @IsString() @MaxLength(64) orderId: string;
  @IsString() @MaxLength(64) paymentId: string;
  @IsString() @MaxLength(200) signature: string;
}
class SubmitDto {
  @IsArray() @ArrayMaxSize(2) @IsIn(["meta", "google"], { each: true }) platforms: string[];
  @IsInt() @Min(500) @Max(10_000_000) budgetInr: number;
  @IsInt() @Min(3) @Max(90) days: number;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) mediaIds: string[];
}
class DecideDto {
  @IsIn(["approve", "reject"]) decision: "approve" | "reject";
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
class AdjustDto {
  @IsNumber() @Min(-1_000_000) @Max(1_000_000) amountInr: number;
  @IsString() @MaxLength(300) note: string;
}

/** The member's ad wallet: balance, history, adding money, invoices. */
@ApiTags("wallet")
@Controller("v1/wallet")
export class WalletController {
  constructor(private readonly ads: AdsService) {}

  @Get() @ApiOperation({ summary: "My ad wallet: balance, money set aside, history, invoices" })
  get(@CurrentUser() u: AuthUser) { return this.ads.wallet(u.id); }

  @Post("topup") @ApiOperation({ summary: "Start adding money (creates a Razorpay order)" })
  topup(@CurrentUser() u: AuthUser, @Body() dto: TopupDto) { return this.ads.startTopup(u.id, dto.amountInr, (dto.billing ?? {}) as Record<string, string>); }

  @Post("topup/confirm") @ApiOperation({ summary: "Finish adding money once the checkout succeeds" })
  confirm(@CurrentUser() u: AuthUser, @Body() dto: ConfirmDto) { return this.ads.confirmTopup(u.id, dto.orderId, dto.paymentId, dto.signature); }

  @Get("invoices/:id")
  invoice(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.ads.invoice(u.id, id, u.isAdmin); }
}

/** Running a campaign's ads: costs, submitting for review, and controls. */
@ApiTags("campaigns")
@Controller("v1/campaigns")
export class CampaignAdsController {
  constructor(private readonly ads: AdsService) {}

  @Get(":id/ads") @ApiOperation({ summary: "Where the ads can run, what it costs, the wallet, and live results" })
  info(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.ads.adsInfo(u.id, id); }

  @Post(":id/submit") @ApiOperation({ summary: "Send the campaign for review (sets the budget aside)" })
  submit(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: SubmitDto) { return this.ads.submit(u.id, id, dto); }

  @Post(":id/withdraw")
  withdraw(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.ads.withdraw(u.id, id); }

  @Post(":id/pause")
  pause(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.ads.pause(u.id, id); }

  @Post(":id/resume")
  resume(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.ads.resume(u.id, id); }

  @Post(":id/end")
  end(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.ads.end(u.id, id); }

  @Post(":id/refresh") @ApiOperation({ summary: "Fetch the latest results from the ad platforms now" })
  refresh(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.ads.refresh(u.id, id); }
}

/** Webhooks from Razorpay (payments) and Meta (leads from our ad forms). */
@ApiTags("webhooks")
@Controller("v1")
export class AdsWebhooksController {
  constructor(private readonly ads: AdsService) {}

  @Public() @Post("payments/razorpay/webhook") @Header("cache-control", "no-store")
  razorpay(@Body() body: Record<string, unknown>, @Req() req: RawBodyRequest<{ headers: Record<string, string | string[] | undefined> }>) {
    const sig = req.headers["x-razorpay-signature"];
    return this.ads.razorpayWebhook(req.rawBody, Array.isArray(sig) ? sig[0] : sig, body);
  }

  /** Meta checks the webhook address once, with the verify word set in Admin → Ads. */
  @Public() @Get("ads/meta/webhook")
  async verify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string) {
    const expected = await this.ads.metaVerifyToken();
    if (mode === "subscribe" && expected && token === expected) return challenge;
    throw new ForbiddenException("Verification failed.");
  }

  @Public() @Post("ads/meta/webhook") @Header("cache-control", "no-store")
  metaLeads(@Body() body: Record<string, unknown>, @Req() req: RawBodyRequest<{ headers: Record<string, string | string[] | undefined> }>) {
    const check = verifyMetaSignature(req.rawBody, req.headers["x-hub-signature-256"], env.META_APP_SECRET, isProd());
    if (!check.ok) throw new ForbiddenException(check.reason);
    return this.ads.metaLeadWebhook(body);
  }
}

/** Admin: review campaigns, ad and payment settings, wallets. */
@ApiTags("admin")
@UseGuards(AdminGuard)
@Controller("v1/admin")
export class AdsAdminController {
  constructor(private readonly ads: AdsService) {}

  @Get("campaigns")
  queue(@Query("status") status?: string) { return this.ads.adminQueue(status ?? "review"); }

  @Post("campaigns/:id/decide") @ApiOperation({ summary: "Approve (creates the ads now) or reject (money goes back)" })
  decide(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: DecideDto) { return this.ads.decide(u.id, id, dto.decision, dto.note); }

  @Get("ads/settings")
  settings() { return this.ads.adminSettings(); }

  @Post("ads/settings")
  save(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) { return this.ads.saveSettings(u.id, body as never); }

  @Post("ads/check") @ApiOperation({ summary: "Try the Meta, Google and Razorpay connections" })
  check() { return this.ads.check(); }

  @Get("wallets")
  wallets(@Query("q") q?: string) { return this.ads.adminWallets(q); }

  @Post("wallets/:ownerId/adjust")
  adjust(@CurrentUser() u: AuthUser, @Param("ownerId") ownerId: string, @Body() dto: AdjustDto) { return this.ads.adjust(u.id, ownerId, dto.amountInr, dto.note); }

  @Get("wallets/invoices/:id")
  invoice(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.ads.invoice(u.id, id, true); }
}
