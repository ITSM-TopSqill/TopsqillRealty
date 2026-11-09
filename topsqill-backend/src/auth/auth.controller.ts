import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsString, Length, IsOptional, IsIn, ValidateNested, MaxLength } from "class-validator";
import { Type } from "class-transformer";
import { AuthService, type Channel } from "./auth.service";
import { Public } from "./public.decorator";
import { clientIp } from "../common/client-ip";
import { env } from "../common/env";

class RequestCodeDto {
  @IsIn(["phone", "email"]) channel: Channel;
  /** A mobile number or an email address, depending on `channel`. */
  @IsString() @Length(3, 160) identifier: string;
  @IsIn(["signin", "signup"]) intent: "signin" | "signup";
}
class SignupProfileDto {
  @IsString() @Length(2, 120) name: string;
  @IsIn(["buyer", "seller", "dealer", "builder"]) type: "buyer" | "seller" | "dealer" | "builder";
  @IsOptional() @IsString() @MaxLength(80) city?: string;
}
class VerifyCodeDto extends RequestCodeDto {
  @IsString() @Length(4, 8) code: string;
  /** Required when signing up: the new account is created with these details. */
  @IsOptional() @ValidateNested() @Type(() => SignupProfileDto) profile?: SignupProfileDto;
  @IsOptional() @IsString() device?: string;
}

/** The original mobile-only endpoints, kept for app builds that still use them. */
class RequestOtpDto { @IsString() @Length(6, 20) phone: string; }
class VerifyOtpDto {
  @IsString() @Length(6, 20) phone: string;
  @IsString() @Length(4, 8) code: string;
  @IsOptional() @IsString() device?: string;
}
class TokenDto { @IsString() refreshToken: string; @IsOptional() @IsString() device?: string; }

@ApiTags("auth")
@Controller("v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Get("methods") @ApiOperation({ summary: "Which sign-in methods can deliver a code right now" })
  methods() { return this.auth.methods(); }

  @Public() @Post("code/request") @ApiOperation({ summary: "Send a sign-in or sign-up code by email or to a mobile number" })
  requestCode(@Body() dto: RequestCodeDto, @Req() req: any) {
    return this.auth.requestCode({ ...dto, ip: clientIp(req, env.INTERNAL_PROXY_SECRET) });
  }

  @Public() @Post("code/verify") @ApiOperation({ summary: "Check the code, then sign in or create the account" })
  verifyCode(@Body() dto: VerifyCodeDto) { return this.auth.verifyCode(dto); }

  @Public() @Post("otp/request") @ApiOperation({ summary: "Mobile only (older apps): send a code" })
  request(@Body() dto: RequestOtpDto, @Req() req: any) {
    return this.auth.requestCode({ channel: "phone", identifier: dto.phone, intent: "auto", ip: clientIp(req, env.INTERNAL_PROXY_SECRET) });
  }

  @Public() @Post("otp/verify") @ApiOperation({ summary: "Mobile only (older apps): check the code and sign in" })
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyCode({ channel: "phone", identifier: dto.phone, code: dto.code, intent: "auto", device: dto.device });
  }

  @Public() @Post("refresh") @ApiOperation({ summary: "Get a new access token" })
  refresh(@Body() dto: TokenDto) { return this.auth.refresh(dto.refreshToken, dto.device); }

  @Public() @Post("logout")
  logout(@Body() dto: TokenDto) { return this.auth.logout(dto.refreshToken); }
}
