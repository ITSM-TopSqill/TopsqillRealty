import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString, MaxLength, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { MessagingService } from "./messaging.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class SendDto {
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @IsOptional() @IsArray() mediaIds?: string[];
  @IsOptional() @IsString() refType?: string;
  @IsOptional() @IsString() refId?: string;
}
class HistoryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@ApiTags("messaging")
@Controller("v1")
export class MessagingController {
  constructor(private readonly svc: MessagingService) {}

  @Get("conversations") @ApiOperation({ summary: "My inbox" })
  inbox(@CurrentUser() user: AuthUser) { return this.svc.inbox(user.id); }

  @Get("conversations/unread") @ApiOperation({ summary: "Unread messages across all chats" })
  unread(@CurrentUser() user: AuthUser) { return this.svc.unreadTotal(user.id); }

  @Post("conversations/with/:peerId") @ApiOperation({ summary: "Open (or reuse) a chat with someone" })
  open(@CurrentUser() user: AuthUser, @Param("peerId") peerId: string) { return this.svc.openWith(user.id, peerId); }

  @Get("conversations/:id/messages")
  history(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query() q: HistoryDto) {
    return this.svc.history(user.id, id, q.cursor, q.limit);
  }

  @Post("conversations/:id/messages")
  send(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: SendDto) {
    return this.svc.send(user.id, id, dto);
  }

  @Post("conversations/:id/read")
  read(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.markRead(user.id, id); }

  @Post("conversations/:id/typing")
  typing(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.typing(user.id, id); }
}
