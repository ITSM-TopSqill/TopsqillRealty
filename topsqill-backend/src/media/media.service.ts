import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { media } from "../db/schema";
import { QueueService, QUEUES } from "../queue/queue.module";
import { newId } from "../common/ids";
import { uploadUrl, publicBase, checkSignature, saveLocalUpload, isLocalStorage, privateReadUrl, writeUpload } from "./storage";
import { CacheService } from "../redis/redis.module";
import { safeFetch, FetchError } from "../common/safe-fetch";

const IMPORTED_PER_DAY = 300;

/** The real type of an image from its first bytes; a server's content-type header isn't trusted. */
export function sniffImage(b: Buffer): { mime: string; ext: string } | null {
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (b.toString("ascii", 4, 8) === "ftyp" && /^avi[fs]$/.test(b.toString("ascii", 8, 12))) return { mime: "image/avif", ext: "avif" };
  return null;
}

const IMAGE = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/avif"];
const VIDEO = ["video/mp4", "video/quicktime", "video/webm"];
const MODEL = ["model/gltf-binary", "application/octet-stream"];
const DOC = ["application/pdf"];
const MAX_BYTES: Record<string, number> = { image: 25e6, video: 500e6, model3d: 80e6, document: 25e6 };


@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly queue: QueueService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Photos from a page the member imported. The server downloads each one
   * (checking it is really a photo, and never from a private address), stores
   * it like a normal upload, and queues the same resizing and AI labelling.
   * Each photo succeeds or fails on its own.
   */
  async importFromUrls(userId: string, urls: string[]) {
    const list = [...new Set(urls)].slice(0, 20);
    const key = `mediaimport:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const used = await this.cache.redis.incrby(key, list.length).catch(() => 0);
    if (used === list.length) await this.cache.redis.expire(key, 86_400).catch(() => {});
    if (used > IMPORTED_PER_DAY) throw new BadRequestException(`You can import up to ${IMPORTED_PER_DAY} photos a day. Upload the rest from your device.`);

    const results: { url: string; mediaId?: string; status: "processing" | "failed"; error?: string }[] = [];
    // A few at a time: fast, without hammering the other site.
    for (let i = 0; i < list.length; i += 4) {
      results.push(...await Promise.all(list.slice(i, i + 4).map((url) => this.importOne(userId, url))));
    }
    return { items: results };
  }

  private async importOne(userId: string, url: string): Promise<{ url: string; mediaId?: string; status: "processing" | "failed"; error?: string }> {
    try {
      const res = await safeFetch(url, { maxBytes: MAX_BYTES.image, timeoutMs: 20_000, accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" });
      const type = sniffImage(res.body);
      if (!type) return { url, status: "failed", error: "Not a JPEG, PNG, WebP or AVIF photo." };
      if (res.body.length < 8_000) return { url, status: "failed", error: "Too small to be a property photo." };
      const id = newId();
      const objectPath = `uploads/${userId}/${id}.${type.ext}`;
      await writeUpload(objectPath, res.body, type.mime);
      // No label: the worker's AI names the room (Kitchen, Exterior...) once it is resized.
      await this.db.insert(media).values({ id, ownerId: userId, kind: "image", status: "processing", objectPath, mimeType: type.mime, bytes: res.body.length, label: null });
      await this.queue.add(QUEUES.media, "process:image", { mediaId: id, kind: "image", objectPath, mimeType: type.mime }, `media-${id}`);
      return { url, mediaId: id, status: "processing" };
    } catch (e) {
      return { url, status: "failed", error: e instanceof FetchError ? e.message : "Couldn’t download this photo." };
    }
  }

  /**
   * The browser never sends large files through our servers. We create a signed
   * upload link, the file goes straight to Cloud Storage, and we then process it
   * in the background. The API stays fast no matter how big the video is.
   */
  async createUpload(userId: string, input: { mimeType: string; bytes: number; filename?: string; private?: boolean }) {
    const kind = IMAGE.includes(input.mimeType) ? "image"
      : VIDEO.includes(input.mimeType) ? "video"
      : DOC.includes(input.mimeType) ? "document"
      : MODEL.includes(input.mimeType) || /\.glb$/i.test(input.filename || "") ? "model3d"
      : null;
    if (!kind) throw new BadRequestException("That file type isn’t supported.");
    // Private files (KYC and RERA documents) are photos or PDFs, never published.
    if (input.private && kind !== "image" && kind !== "document") throw new BadRequestException("Upload a photo or a PDF of the document.");
    if (!input.bytes || input.bytes > MAX_BYTES[kind]) throw new BadRequestException(`That file is too large. The limit is ${Math.round(MAX_BYTES[kind] / 1e6)} MB.`);

    const id = newId();
    const ext = (input.filename?.split(".").pop() || input.mimeType.split("/")[1] || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const objectPath = `${input.private ? "private" : "uploads"}/${userId}/${id}.${ext}`;

    await this.db.insert(media).values({
      id, ownerId: userId, kind: (input.private ? "document" : kind) as never, status: "uploading", objectPath, mimeType: input.mimeType, bytes: input.bytes,
      groupName: input.private ? "private" : null, label: input.filename?.slice(0, 60) ?? null,
    });
    const url = await uploadUrl(id, objectPath, input.mimeType);
    return { mediaId: id, uploadUrl: url, method: "PUT", headers: { "content-type": input.mimeType }, expiresInSeconds: 900 };
  }

  /** Local development only: the browser PUTs the file to the API, which keeps it on disk. */
  async localUpload(mediaId: string, exp: string, sig: string, body: Buffer | undefined) {
    if (!isLocalStorage) throw new NotFoundException();
    if (!checkSignature(`up:${mediaId}:${exp}`, sig) || Number(exp) < Date.now()) throw new BadRequestException("This upload link has expired. Please try again.");
    if (!body?.length) throw new BadRequestException("The file was empty.");
    const [row] = await this.read.select().from(media).where(and(eq(media.id, mediaId), eq(media.status, "uploading"))).limit(1);
    if (!row) throw new NotFoundException("That upload could not be found.");
    if (row.bytes && body.length > row.bytes * 1.05 + 1024) throw new BadRequestException("The file is larger than announced.");
    await saveLocalUpload(row.objectPath, body);
    return { ok: true };
  }

  /** The app calls this once the upload finishes; processing then runs in the background. */
  async confirmUpload(userId: string, mediaId: string) {
    const [current] = await this.read.select({ groupName: media.groupName }).from(media).where(and(eq(media.id, mediaId), eq(media.ownerId, userId))).limit(1);
    const isPrivate = current?.groupName === "private";
    // Private documents are kept exactly as uploaded and never copied anywhere public.
    const [row] = await this.db.update(media).set({ status: isPrivate ? "ready" : "processing" })
      .where(and(eq(media.id, mediaId), eq(media.ownerId, userId), eq(media.status, "uploading"))).returning();
    if (!row) throw new NotFoundException("That upload could not be found.");
    if (isPrivate) return { mediaId: row.id, status: "ready" };
    // jobId = mediaId, so a repeated call never processes the same file twice.
    await this.queue.add(QUEUES.media, `process:${row.kind}`, { mediaId: row.id, kind: row.kind, objectPath: row.objectPath, mimeType: row.mimeType }, `media-${row.id}`);
    return { mediaId: row.id, status: "processing" };
  }

  /** A short-lived link to a private document, for its owner or an admin. */
  async privateLink(mediaId: string) {
    const [row] = await this.read.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!row || row.groupName !== "private") throw new NotFoundException("That document could not be found.");
    return { url: await privateReadUrl(row.objectPath), mimeType: row.mimeType, label: row.label };
  }

  async get(mediaId: string) {
    const [row] = await this.read.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!row) throw new NotFoundException("Media not found.");
    return this.publicView(row);
  }

  /** What the app receives: CDN links only, never bucket paths. */
  publicView(row: typeof media.$inferSelect) {
    const base = publicBase();
    const urls: Record<string, string> = {};
    // Private documents never get public links.
    if (row.groupName !== "private") {
      for (const [k, v] of Object.entries(row.variants || {})) urls[k] = v.startsWith("http") ? v : `${base}/${v}`;
    }
    return {
      id: row.id, kind: row.kind, status: row.status, label: row.label, group: row.groupName,
      caption: row.caption, width: row.width, height: row.height, durationMs: row.durationMs,
      blurhash: row.blurhash, urls,
      ...(row.kind === "video" && row.scenes ? { scenes: row.scenes } : {}),
    };
  }
}
