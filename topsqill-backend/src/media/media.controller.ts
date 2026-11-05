import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsString, IsInt, IsOptional, Min } from "class-validator";
import { MediaService } from "./media.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

class CreateUploadDto {
  @IsString() mimeType: string;
  @IsInt() @Min(1) bytes: number;
  @IsOptional() @IsString() filename?: string;
}

@ApiTags("media")
@Controller("v1/media")
export class MediaController {
  constructor(private readonly svc: MediaService) {}

  @Post("uploads") @ApiOperation({ summary: "Get a direct upload link for a photo, video or 3D model" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUploadDto) { return this.svc.createUpload(user.id, dto); }

  @Post(":id/confirm") @ApiOperation({ summary: "Tell the server the upload finished" })
  confirm(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.confirmUpload(user.id, id); }

  @Public() @Get(":id")
  get(@Param("id") id: string) { return this.svc.get(id); }
}
