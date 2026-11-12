import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { IsBoolean } from "class-validator";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsString, IsInt, IsOptional, Min, IsArray, ArrayMaxSize, ArrayMinSize, MaxLength, Equals } from "class-validator";
import { MediaService } from "./media.service";
import { CurrentUser, AuthUser, Public } from "../auth/public.decorator";
import { isLocalStorage, readLocal, checkSignature } from "./storage";

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", heic: "image/heic", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", glb: "model/gltf-binary", m3u8: "application/vnd.apple.mpegurl" };
const typeOf = (path: string) => TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

class CreateUploadDto {
  @IsString() mimeType: string;
  @IsInt() @Min(1) bytes: number;
  @IsOptional() @IsString() filename?: string;
  /** KYC and RERA documents: kept private, never processed or published. */
  @IsOptional() @IsBoolean() private?: boolean;
}

@ApiTags("media")
@Controller("v1/media")
export class MediaController {
  constructor(private readonly svc: MediaService) {}

  @Post("uploads") @ApiOperation({ summary: "Get a direct upload link for a photo, video or 3D model" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUploadDto) { return this.svc.createUpload(user.id, dto); }

  @Get("mine") @ApiOperation({ summary: "My recent photos and videos from one source: whatsapp, instagram or upload" })
  mine(@CurrentUser() user: AuthUser, @Query("source") source = "whatsapp") {
    if (!["whatsapp", "instagram", "upload"].includes(source)) throw new BadRequestException("Unknown source.");
    return this.svc.mine(user.id, source as "whatsapp" | "instagram" | "upload");
  }

  @Post(":id/confirm") @ApiOperation({ summary: "Tell the server the upload finished" })
  confirm(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.svc.confirmUpload(user.id, id); }

  /* ------------- local development storage (no Cloud Storage) ------------- */

  @Public() @Put(":id/local-upload")
  localUpload(@Param("id") id: string, @Query("exp") exp: string, @Query("sig") sig: string, @Req() req: FastifyRequest) {
    return this.svc.localUpload(id, exp, sig, Buffer.isBuffer(req.body) ? req.body : undefined);
  }

  @Public() @Get("local/public/*")
  async localPublic(@Param("*") path: string, @Res() reply: FastifyReply) {
    if (!isLocalStorage) throw new NotFoundException();
    const body = await readLocal("public", path).catch(() => { throw new NotFoundException(); });
    // Served to the website on another port, so allow cross-origin image loads.
    reply.header("cross-origin-resource-policy", "cross-origin").header("cache-control", "public, max-age=31536000, immutable")
      .type(typeOf(path)).send(body);
  }

  @Public() @Get("local/private")
  async localPrivate(@Query("path") path: string, @Query("exp") exp: string, @Query("sig") sig: string, @Res() reply: FastifyReply) {
    if (!isLocalStorage) throw new NotFoundException();
    if (!path || !checkSignature(`read:${path}:${exp}`, sig)) throw new ForbiddenException();
    if (Number(exp) < Date.now()) throw new BadRequestException("This link has expired.");
    const body = await readLocal("uploads", path).catch(() => { throw new NotFoundException(); });
    reply.header("cross-origin-resource-policy", "cross-origin").header("cache-control", "private, no-store").type(typeOf(path)).send(body);
  }

  @Public() @Get(":id")
  get(@Param("id") id: string) { return this.svc.get(id); }
}
