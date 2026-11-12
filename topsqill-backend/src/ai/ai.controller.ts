import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength, IsObject, IsArray, IsInt } from "class-validator";
import { WriterService } from "./writer.service";
import { ProjectsService } from "./projects.service";
import { AssistantService } from "./assistant.service";
import { ListingChatService } from "./listing-chat.service";
import { ListingImportService } from "./listing-import.service";
import { Type } from "class-transformer";
import { ValidateNested, ArrayMaxSize } from "class-validator";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

class ImportDto {
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @IsOptional() @IsString() @MaxLength(60000) text?: string;
}
class ListingImportDto {
  @IsString() @MaxLength(2000) url: string;
  /** The page text, pasted, for sites that block robots or build the page in the browser. */
  @IsOptional() @IsString() @MaxLength(60000) text?: string;
}
class ProfileDto {
  @IsString() name: string;
  @IsIn(["buyer", "seller", "dealer", "builder"]) type: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsArray() localities?: string[];
  @IsOptional() @IsString() agency?: string;
  @IsOptional() @IsInt() years?: number;
  @IsOptional() @IsString() @MaxLength(600) notes?: string;
}
class PostDto {
  @IsString() @MaxLength(600) topic: string;
  @IsOptional() @IsIn(["write", "punchy", "short", "hinglish", "tags", "fix"]) tone?: "write" | "punchy" | "short" | "hinglish" | "tags" | "fix";
  @IsOptional() @IsString() @MaxLength(5000) current?: string;
}
class ListingCopyDto { @IsObject() listing: Record<string, unknown>; @IsOptional() @IsInt() localityRate?: number; }
class FollowUpDto {
  @IsIn(["whatsapp", "email", "call"]) channel: "whatsapp" | "email" | "call";
  @IsObject() lead: Record<string, unknown>;
}
class CommentDto { @IsString() @MaxLength(4000) postBody: string; }
class TurnDto {
  @IsIn(["user", "assistant"]) role: "user" | "assistant";
  @IsString() @MaxLength(6000) text: string;
}
class AskDto {
  @IsString() @MaxLength(1000) message: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TurnDto) history?: TurnDto[];
}

@ApiTags("ai")
@Controller("v1/ai")
export class AiController {
  constructor(
    private readonly writer: WriterService,
    private readonly projects: ProjectsService,
    private readonly assistant: AssistantService,
    private readonly listingChat: ListingChatService,
    private readonly importer: ListingImportService,
  ) {}

  @Post("listings/import") @ApiOperation({ summary: "Draft a listing from another listing or project page (nothing is published)" })
  importListing(@CurrentUser() user: AuthUser, @Body() dto: ListingImportDto) { return this.importer.preview(user.id, dto); }

  @Post("assistant") @ApiOperation({ summary: "Ask Topsqill.ai: search, match, price and write in one chat" })
  ask(@CurrentUser() user: AuthUser, @Body() dto: AskDto) { return this.assistant.ask(user.id, dto.message, dto.history ?? []); }

  @Post("listings/:id/ask") @ApiOperation({ summary: "Answer a question about one listing, from its facts only" })
  askListing(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AskDto) {
    return this.listingChat.ask(user.id, id, dto.message, dto.history ?? []);
  }

  @Post("projects/import") @ApiOperation({ summary: "Build a full project listing from a link and its page text" })
  importProject(@CurrentUser() user: AuthUser, @Body() dto: ImportDto) { return this.projects.importFromUrl(user.id, dto); }

  @Get("projects/mine")
  mine(@CurrentUser() user: AuthUser) { return this.projects.mine(user.id); }

  @Public() @Get("projects/:id")
  project(@Param("id") id: string) { return this.projects.get(id); }

  @Post("projects/:id/publish") @ApiOperation({ summary: "Create one live listing per configuration" })
  publish(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.projects.publish(user.id, id); }

  @Post("write/profile")
  profile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) { return this.writer.profile(user.id, dto as never); }

  @Post("write/listing")
  listing(@CurrentUser() user: AuthUser, @Body() dto: ListingCopyDto) { return this.writer.listingCopy(user.id, dto.listing, dto.localityRate); }

  @Post("write/post")
  post(@CurrentUser() user: AuthUser, @Body() dto: PostDto) { return this.writer.post(user.id, dto.topic, dto.tone ?? "write", dto.current); }

  @Post("write/comment")
  comment(@CurrentUser() user: AuthUser, @Body() dto: CommentDto) { return this.writer.comment(user.id, dto.postBody, { id: user.id, type: user.type }); }

  @Post("write/follow-up")
  followUp(@CurrentUser() user: AuthUser, @Body() dto: FollowUpDto) {
    return this.writer.senderOf(user.id).then((sender) => this.writer.leadFollowUp(user.id, dto.channel, dto.lead, sender));
  }
}
