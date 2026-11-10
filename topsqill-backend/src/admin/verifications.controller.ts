import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsArray, ArrayMaxSize, ValidateNested, MaxLength } from "class-validator";
import { Type } from "class-transformer";
import { AdminService } from "./admin.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class DocDto {
  @IsString() @MaxLength(40) label: string;
  @IsString() mediaId: string;
}
class SubmitDto {
  @IsIn(["kyc", "rera"]) kind: "kyc" | "rera";
  @IsOptional() @IsString() @MaxLength(64) reraNumber?: string;
  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => DocDto) documents: DocDto[];
}

/** Members asking to be verified (KYC or RERA). Reviewed in the admin console. */
@ApiTags("verification")
@Controller("v1/verifications")
export class VerificationsController {
  constructor(private readonly svc: AdminService) {}

  @Post() @ApiOperation({ summary: "Submit documents for KYC or RERA verification" })
  submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitDto) { return this.svc.submitVerification(user.id, dto); }

  @Get("mine")
  mine(@CurrentUser() user: AuthUser) { return this.svc.myVerifications(user.id); }
}
