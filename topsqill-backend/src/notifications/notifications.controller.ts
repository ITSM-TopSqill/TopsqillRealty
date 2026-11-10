import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsString, IsOptional, IsInt, Min, Max, IsArray, ArrayMaxSize } from "class-validator";
import { Type } from "class-transformer";
import { NotificationsService } from "./notifications.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class PushTokenDto {
  @IsString() token: string;
  @IsIn(["web", "android", "ios"]) platform: string;
}
class ReadDto { @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) ids: string[]; }
class ListDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@ApiTags("notifications")
@Controller("v1/notifications")
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get() @ApiOperation({ summary: "My notifications" })
  list(@CurrentUser() user: AuthUser, @Query() q: ListDto) { return this.svc.list(user.id, q.cursor, q.limit); }

  @Get("unread")
  unread(@CurrentUser() user: AuthUser) { return this.svc.unreadCount(user.id); }

  @Get("latest") @ApiOperation({ summary: "Newest unread alerts, for the pop-up" })
  latest(@CurrentUser() user: AuthUser) { return this.svc.latestUnread(user.id); }

  @Post("read")
  read(@CurrentUser() user: AuthUser, @Body() dto: ReadDto) { return this.svc.markRead(user.id, dto.ids); }

  @Post("read-all")
  readAll(@CurrentUser() user: AuthUser) { return this.svc.markAllRead(user.id); }

  @Post("push-token")
  push(@CurrentUser() user: AuthUser, @Body() dto: PushTokenDto) {
    return this.svc.registerPushToken(user.id, dto.token, dto.platform);
  }
}
