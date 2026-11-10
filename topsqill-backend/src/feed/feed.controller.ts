import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsOptional, IsString, IsArray, IsIn, MaxLength, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { FeedService } from "./feed.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";

class CreatePostDto {
  @IsString() @MaxLength(5000) body: string;
  @IsOptional() @IsIn(["update", "listing", "requirement", "project", "job", "insight"]) kind?: string;
  @IsOptional() @IsString() refId?: string;
  @IsOptional() @IsArray() mediaIds?: string[];
}
class EditPostDto { @IsString() @MaxLength(5000) body: string; }
class CommentDto { @IsString() @MaxLength(1000) body: string; }
class FeedQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@ApiTags("feed")
@Controller("v1")
export class FeedController {
  constructor(private readonly svc: FeedService) {}

  @Get("feed") @ApiOperation({ summary: "Home feed" })
  home(@CurrentUser() user: AuthUser, @Query() q: FeedQueryDto) {
    return this.svc.home(user.id, q.cursor, q.limit);
  }

  @Post("posts")
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto) { return this.svc.createPost(user.id, dto); }

  @Patch("posts/:id")
  edit(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: EditPostDto) { return this.svc.editPost(user.id, id, dto.body); }

  @Delete("posts/:id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.deletePost(user.id, id); }

  @Delete("posts/:id/comments/:commentId")
  removeComment(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("commentId") commentId: string) {
    return this.svc.deleteComment(user.id, id, commentId);
  }

  @Post("posts/:id/like")
  like(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.like(user.id, id, true); }

  @Delete("posts/:id/like")
  unlike(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.like(user.id, id, false); }

  @Post("posts/:id/comments")
  comment(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CommentDto) {
    return this.svc.comment(user.id, id, dto.body);
  }

  @Public() @Get("posts/:id")
  getPost(@Param("id") id: string, @CurrentUser() user?: AuthUser) { return this.svc.getPost(id, user?.id); }

  @Public() @Get("posts/:id/comments")
  comments(@Param("id") id: string) { return this.svc.comments(id); }
}
