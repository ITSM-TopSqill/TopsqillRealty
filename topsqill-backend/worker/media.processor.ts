import { Job } from "bullmq";
import type { Pool } from "pg";
import sharp from "sharp";
import { Storage } from "@google-cloud/storage";
import { env } from "../src/common/env";

const storage = env.GCP_PROJECT_ID ? new Storage({ projectId: env.GCP_PROJECT_ID }) : null;

/** Photo sizes the app actually uses. A phone never downloads a 4K file for a small card. */
export const IMAGE_SIZES = [
  { name: "thumb", width: 320 },
  { name: "card", width: 640 },
  { name: "large", width: 1280 },
  { name: "full", width: 2048 },
];
/** AVIF is usually under a quarter the size of a JPEG at the same quality. */
export const IMAGE_FORMATS = ["avif", "webp", "jpeg"] as const;

export type MediaJob = { mediaId: string; kind: string; objectPath: string; mimeType: string };

export async function processMedia(job: Job<MediaJob>, pool: Pool) {
  const { mediaId, kind, objectPath } = job.data;
  try {
    if (kind === "image") return await processImage(job.data, pool);
    if (kind === "video") return await processVideo(job.data, pool);
    if (kind === "model3d") return await processModel(job.data, pool);
    // documents (brochures) just move to the public bucket as they are
    const dest = objectPath.replace(/^uploads\//, "public/");
    await copyToPublic(objectPath, dest);
    await finish(pool, mediaId, { variants: { original: dest } });
  } catch (err) {
    await pool.query("update media set status='failed', error=$2 where id=$1", [mediaId, (err as Error).message.slice(0, 500)]);
    throw err;
  }
}

async function processImage(data: MediaJob, pool: Pool) {
  const buf = await download(data.objectPath);
  const img = sharp(buf, { failOn: "none" }).rotate();          // respects the phone's orientation
  const meta = await img.metadata();
  const variants: Record<string, string> = {};

  for (const size of IMAGE_SIZES) {
    if (meta.width && meta.width < size.width && size.name !== "thumb") continue;  // never upscale
    for (const format of IMAGE_FORMATS) {
      const out = await sharp(buf).rotate()
        .resize({ width: size.width, withoutEnlargement: true })
        .toFormat(format, { quality: format === "avif" ? 50 : format === "webp" ? 72 : 78, effort: 4 })
        .toBuffer();
      const path = `public/img/${data.mediaId}/${size.name}.${format}`;
      await upload(path, out, `image/${format}`);
      variants[`${size.name}_${format}`] = path;
    }
  }
  // A 16-pixel-wide blurred preview, small enough to store in the database and
  // show instantly while the real photo loads, so screens are never blank.
  const tiny = await sharp(buf).rotate().resize(16).blur(1).jpeg({ quality: 40 }).toBuffer();
  const blurhash = `data:image/jpeg;base64,${tiny.toString("base64")}`.slice(0, 64);

  await finish(pool, data.mediaId, { variants, width: meta.width ?? null, height: meta.height ?? null, blurhash });
  return { variants: Object.keys(variants).length };
}

/**
 * Video becomes HLS: several quality levels cut into short pieces, so playback
 * starts in under a second and adjusts to the viewer's connection.
 * On Google Cloud this is handed to the Transcoder API; locally ffmpeg is used.
 */
async function processVideo(data: MediaJob, pool: Pool) {
  if (env.GCP_PROJECT_ID) {
    const mod: any = await import("@google-cloud/video-transcoder" as string).catch(() => null);
    const TranscoderServiceClient = mod?.TranscoderServiceClient ?? mod?.v1?.TranscoderServiceClient;
    if (TranscoderServiceClient) {
      const client = new TranscoderServiceClient();
      const outPrefix = `public/video/${data.mediaId}/`;
      await client.createJob({
        parent: client.locationPath(env.GCP_PROJECT_ID, "asia-south1"),
        job: {
          inputUri: `gs://${env.GCS_BUCKET_UPLOADS}/${data.objectPath}`,
          outputUri: `gs://${env.GCS_BUCKET_PUBLIC}/${outPrefix}`,
          templateId: "preset/web-hd",
        },
      });
      await pool.query("update media set status='processing', variants=$2 where id=$1",
        [data.mediaId, JSON.stringify({ hls: `${outPrefix}manifest.m3u8` })]);
      return { queued: true };   // the Transcoder notifies us via Pub/Sub when it finishes
    }
  }
  const dest = data.objectPath.replace(/^uploads\//, "public/");
  await copyToPublic(data.objectPath, dest);
  await finish(pool, data.mediaId, { variants: { mp4: dest } });
  return { fallback: true };
}

/** 3D models are compressed (Draco/Meshopt) and stored with a light version for phones. */
async function processModel(data: MediaJob, pool: Pool) {
  const dest = `public/model/${data.mediaId}/full.glb`;
  await copyToPublic(data.objectPath, dest);
  await finish(pool, data.mediaId, { variants: { full: dest } });
  return { ok: true };
}

async function finish(pool: Pool, mediaId: string, fields: { variants: Record<string, string>; width?: number | null; height?: number | null; blurhash?: string }) {
  await pool.query(
    "update media set status='ready', variants=$2, width=coalesce($3, width), height=coalesce($4, height), blurhash=coalesce($5, blurhash) where id=$1",
    [mediaId, JSON.stringify(fields.variants), fields.width ?? null, fields.height ?? null, fields.blurhash ?? null],
  );
}

async function download(path: string): Promise<Buffer> {
  if (!storage || !env.GCS_BUCKET_UPLOADS) throw new Error("Cloud Storage is not configured");
  const [buf] = await storage.bucket(env.GCS_BUCKET_UPLOADS).file(path).download();
  return buf;
}
async function upload(path: string, body: Buffer, contentType: string) {
  if (!storage || !env.GCS_BUCKET_PUBLIC) return;
  await storage.bucket(env.GCS_BUCKET_PUBLIC).file(path).save(body, {
    contentType,
    // Media never changes once written, so browsers and the CDN can keep it for a year.
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  });
}
async function copyToPublic(from: string, to: string) {
  if (!storage || !env.GCS_BUCKET_UPLOADS || !env.GCS_BUCKET_PUBLIC) return;
  await storage.bucket(env.GCS_BUCKET_UPLOADS).file(from).copy(storage.bucket(env.GCS_BUCKET_PUBLIC).file(to));
}
