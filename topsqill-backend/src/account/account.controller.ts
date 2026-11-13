import { Body, Controller, Delete, Get, Param, Post, Query, Header } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { AccountService } from "./account.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

class AlertSettingsDto {
  @IsOptional() @IsObject() email?: Record<string, boolean>;
  @IsOptional() @IsObject() push?: Record<string, boolean>;
}
class DeleteAccountDto { @IsString() @MaxLength(20) confirm: string; }
class UnsubscribeDto {
  @IsString() @MaxLength(40) u: string;
  @IsString() @MaxLength(20) k: string;
  @IsString() @MaxLength(64) t: string;
}

@ApiTags("account")
@Controller("v1")
export class AccountController {
  constructor(private readonly svc: AccountService) {}

  @Post("profiles/:id/block") @ApiOperation({ summary: "Block a member: no messages, invitations or posts either way" })
  block(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.block(user.id, id); }

  @Delete("profiles/:id/block")
  unblock(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.unblock(user.id, id); }

  @Get("me/blocked") @ApiOperation({ summary: "Members I blocked" })
  blocked(@CurrentUser() user: AuthUser) { return this.svc.blocked(user.id); }

  @Get("me/alert-settings") @ApiOperation({ summary: "Which alerts reach me by email and push" })
  alerts(@CurrentUser() user: AuthUser) { return this.svc.alertSettings(user.id); }

  @Post("me/alert-settings")
  saveAlerts(@CurrentUser() user: AuthUser, @Body() dto: AlertSettingsDto) { return this.svc.saveAlertSettings(user.id, dto); }

  @Get("me/deletion") @ApiOperation({ summary: "Whether my account can be deleted now, and what would go" })
  deletion(@CurrentUser() user: AuthUser) { return this.svc.deletionCheck(user.id); }

  @Post("me/delete") @ApiOperation({ summary: "Delete my account for good" })
  remove(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto) { return this.svc.deleteAccount(user.id, dto.confirm); }

  /** From the button on the website's unsubscribe page. */
  @Public() @Post("alerts/unsubscribe")
  unsubscribe(@Body() dto: UnsubscribeDto) { return this.svc.unsubscribe(dto.u, dto.k, dto.t); }

  /** Mail apps' one-click unsubscribe (RFC 8058) posts here with the details in the link. */
  @Public() @Post("alerts/unsubscribe/one-click") @Header("Cache-Control", "no-store")
  oneClick(@Query() q: UnsubscribeDto) { return this.svc.unsubscribe(q.u, q.k, q.t); }
}
