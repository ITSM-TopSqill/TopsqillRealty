import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { eq, and, desc, inArray, ne } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { media } from "../db/schema";
import { QueueService, QUEUES } from "../queue/queue.module";
import { newId } from "../common/ids";
import { uploadUrl, publicBase, checkSignature, saveLocalUpload, isLocalStorage, privateReadUrl, writeUpload } from "./storage";
import { CacheService } from "../redis/redis.module";

/** The real type of an image from its first bytes; a server's content-type header isn't trusted. */
export function sniffImage(b: Buffer): { mime: string; ext: string } | null {
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (b.toString("ascii", 4, 8) === "ftyp" && /^avi[fs]$/.test(b.toString("ascii", 8, 12))) return { mime: "image/avif", ext: "avif" };
  return null;
}

/** What a listing file is, chosen by the section it was uploaded in: its label on the listing and its group. */
export const MEDIA_CATEGORIES: Record<string, { label: string | null; group: string | null }> = {
  photo: { label: null, group: null },
  video: { label: "Walkthrough video", group: null },
  reel: { label: "Reel", group: null },
  floorplan: { label: "Floor plan", group: "plan" },
  siteplan: { label: "Site plan", group: "plan" },
  locationmap: { label: "Location map", group: "plan" },
  brochure: { label: "Brochure", group: "other" },
  pricelist: { label: "Price list", group: "other" },
  model: { label: "3D model", group: null },
};

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
  /**
   * Stores a photo or video the member sent us themselves (to Topsqill's
   * WhatsApp number, or picked from their own Instagram) and processes it like
   * an upload. Nothing is ever taken from other sites.
   */
  async storeOwn(userId: string, body: Buffer, mimeHint: string, source: "whatsapp" | "instagram") {
    const img = sniffImage(body);
    const isVideo = !img && /^video\//.test(mimeHint);
    if (!img && !isVideo) throw new BadRequestException("Only photos and videos can be added.");
    const kind = img ? "image" : "video";
    if (body.length > MAX_BYTES[kind]) throw new BadRequestException(`That file is too large. The limit is ${Math.round(MAX_BYTES[kind] / 1e6)} MB.`);
    if (img && body.length < 8_000) throw new BadRequestException("That photo is too small.");
    const mime = img ? img.mime : (VIDEO.includes(mimeHint) ? mimeHint : "video/mp4");
    const ext = img ? img.ext : mime === "video/quicktime" ? "mov" : mime === "video/webm" ? "webm" : "mp4";
    const id = newId();
    const objectPath = `uploads/${userId}/${id}.${ext}`;
    await writeUpload(objectPath, body, mime);
    // No label: the worker's AI names the room (Kitchen, Exterior...) once a photo is resized.
    await this.db.insert(media).values({ id, ownerId: userId, kind, status: "processing", objectPath, mimeType: mime, bytes: body.length, label: null, source });
    await this.queue.add(QUEUES.media, `process:${kind}`, { mediaId: id, kind, objectPath, mimeType: mime }, `media-${id}`);
    return { mediaId: id, kind, status: "processing" as const };
  }

  /** My recent photos and videos from one source (WhatsApp or Instagram), newest first, for picking into a listing. */
  async mine(userId: string, source: "whatsapp" | "instagram" | "upload") {
    const rows = await this.read.select().from(media)
      .where(and(eq(media.ownerId, userId), eq(media.source, source), inArray(media.kind, ["image", "video"]), ne(media.status, "failed")))
      .orderBy(desc(media.createdAt)).limit(60);
    return { items: rows.map((r) => this.publicView(r)) };
  }

  /**
   * The browser never sends large files through our servers. We create a signed
   * upload link, the file goes straight to Cloud Storage, and we then process it
   * in the background. The API stays fast no matter how big the video is.
   */
  async createUpload(userId: string, input: { mimeType: string; bytes: number; filename?: string; private?: boolean; category?: string }) {
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
      groupName: input.private ? "private" : MEDIA_CATEGORIES[input.category ?? ""]?.group ?? null,
      // A category gives the file its name on the listing ("Floor plan", "Reel"); plain photos are named by AI later.
      // Photos start unnamed (the worker's AI names the room); a file name like "IMG_2034.jpg" is never shown to buyers.
      label: !input.private && input.category && input.category in MEDIA_CATEGORIES ? MEDIA_CATEGORIES[input.category].label : input.private ? input.filename?.slice(0, 60) ?? null : null,
      source: input.private ? null : "upload",
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
    };
  }
}
