import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsString, Length, IsOptional } from "class-validator";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";

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

  @Public() @Post("otp/request") @ApiOperation({ summary: "Send a one-time code to a mobile number" })
  request(@Body() dto: RequestOtpDto, @Req() req: any) {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
    return this.auth.requestOtp(dto.phone, ip);
  }

  @Public() @Post("otp/verify") @ApiOperation({ summary: "Check the code and sign in" })
  verify(@Body() dto: VerifyOtpDto) { return this.auth.verifyOtp(dto.phone, dto.code, dto.device); }

  @Public() @Post("refresh") @ApiOperation({ summary: "Get a new access token" })
  refresh(@Body() dto: TokenDto) { return this.auth.refresh(dto.refreshToken, dto.device); }

  @Public() @Post("logout")
  logout(@Body() dto: TokenDto) { return this.auth.logout(dto.refreshToken); }
}
