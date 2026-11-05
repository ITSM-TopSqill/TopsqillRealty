import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { media } from "../db/schema";
import { QueueService, QUEUES } from "../queue/queue.module";
import { newId } from "../common/ids";
import { env } from "../common/env";
import { Storage } from "@google-cloud/storage";

const IMAGE = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/avif"];
const VIDEO = ["video/mp4", "video/quicktime", "video/webm"];
const MODEL = ["model/gltf-binary", "application/octet-stream"];
const DOC = ["application/pdf"];
const MAX_BYTES: Record<string, number> = { image: 25e6, video: 500e6, model3d: 80e6, document: 25e6 };

const storage = env.GCP_PROJECT_ID ? new Storage({ projectId: env.GCP_PROJECT_ID }) : null;

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly queue: QueueService,
  ) {}

  /**
   * The browser never sends large files through our servers. We create a signed
   * upload link, the file goes straight to Cloud Storage, and we then process it
   * in the background. The API stays fast no matter how big the video is.
   */
  async createUpload(userId: string, input: { mimeType: string; bytes: number; filename?: string }) {
    const kind = IMAGE.includes(input.mimeType) ? "image"
      : VIDEO.includes(input.mimeType) ? "video"
      : DOC.includes(input.mimeType) ? "document"
      : MODEL.includes(input.mimeType) || /\.glb$/i.test(input.filename || "") ? "model3d"
      : null;
    if (!kind) throw new BadRequestException("That file type isn’t supported.");
    if (!input.bytes || input.bytes > MAX_BYTES[kind]) throw new BadRequestException(`That file is too large. The limit is ${Math.round(MAX_BYTES[kind] / 1e6)} MB.`);

    const id = newId();
    const ext = (input.filename?.split(".").pop() || input.mimeType.split("/")[1] || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const objectPath = `uploads/${userId}/${id}.${ext}`;

    await this.db.insert(media).values({ id, ownerId: userId, kind: kind as any, status: "uploading", objectPath, mimeType: input.mimeType, bytes: input.bytes });

    let uploadUrl = `dev://local/${objectPath}`;
    if (storage && env.GCS_BUCKET_UPLOADS) {
      const [url] = await storage.bucket(env.GCS_BUCKET_UPLOADS).file(objectPath).getSignedUrl({
        version: "v4", action: "write", expires: Date.now() + 15 * 60 * 1000, contentType: input.mimeType,
      });
      uploadUrl = url;
    }
    return { mediaId: id, uploadUrl, method: "PUT", headers: { "content-type": input.mimeType }, expiresInSeconds: 900 };
  }

  /** The app calls this once the upload finishes; processing then runs in the background. */
  async confirmUpload(userId: string, mediaId: string) {
    const [row] = await this.db.update(media).set({ status: "processing" })
      .where(and(eq(media.id, mediaId), eq(media.ownerId, userId), eq(media.status, "uploading"))).returning();
    if (!row) throw new NotFoundException("That upload could not be found.");
    // jobId = mediaId, so a repeated call never processes the same file twice.
    await this.queue.add(QUEUES.media, `process:${row.kind}`, { mediaId: row.id, kind: row.kind, objectPath: row.objectPath, mimeType: row.mimeType }, `media-${row.id}`);
    return { mediaId: row.id, status: "processing" };
  }

  async get(mediaId: string) {
    const [row] = await this.read.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!row) throw new NotFoundException("Media not found.");
    return this.publicView(row);
  }

  /** What the app receives: CDN links only, never bucket paths. */
  publicView(row: typeof media.$inferSelect) {
    const base = env.CDN_BASE_URL || "";
    const urls: Record<string, string> = {};
    for (const [k, v] of Object.entries(row.variants || {})) urls[k] = v.startsWith("http") ? v : `${base}/${v}`;
    return {
      id: row.id, kind: row.kind, status: row.status, label: row.label, group: row.groupName,
      caption: row.caption, width: row.width, height: row.height, durationMs: row.durationMs,
      blurhash: row.blurhash, urls,
    };
  }
}
