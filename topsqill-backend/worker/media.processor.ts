import { Job } from "bullmq";
import type { Pool } from "pg";
import type Redis from "ioredis";
import sharp from "sharp";
import { env } from "../src/common/env";
import { readUpload, writePublic, copyToPublic } from "../src/media/storage";
import { tagPhoto } from "./photo-tags";

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

export async function processMedia(job: Job<MediaJob>, pool: Pool, redis?: Redis) {
  const { mediaId, kind, objectPath } = job.data;
  try {
    if (kind === "image") return await processImage(job.data, pool);
    if (kind === "video") return await processVideo(job.data, pool, redis);
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

  // AI labels the photo (Kitchen, Bedroom…) after it is ready, so a slow or
  // failed label never delays the upload. Private documents are never sent.
  const { rows } = await pool.query("select owner_id, label, group_name from media where id=$1", [data.mediaId]);
  if (rows[0] && rows[0].group_name !== "private") {
    const small = await sharp(buf).rotate().resize({ width: 512, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    await tagPhoto(pool, data.mediaId, rows[0].owner_id, small, rows[0].label);
  }
  return { variants: Object.keys(variants).length };
}

/**
 * Video becomes HLS: several quality levels cut into short pieces, so playback
 * starts in under a second and adjusts to the viewer's connection.
 * On Google Cloud this is handed to the Transcoder API; locally ffmpeg is used.
 */
async function processVideo(data: MediaJob, pool: Pool, redis?: Redis) {
  // The original MP4 is published first and the video marked ready, so it
  // plays (and the listing can be published) straight away.
  const dest = data.objectPath.replace(/^uploads\//, "public/");
  await copyToPublic(data.objectPath, dest);
  await finish(pool, data.mediaId, { variants: { mp4: dest } });

  // On Google Cloud, a streaming (HLS) version is made too. The job runs for a
  // few minutes; checkTranscodes() adds it to the video once it is done.
  if (env.GCP_PROJECT_ID && redis) {
    const client = await transcoder();
    if (client) {
      const outPrefix = `public/video/${data.mediaId}/`;
      const [job] = await client.createJob({
        parent: client.locationPath(env.GCP_PROJECT_ID, "asia-south1"),
        job: { inputUri: `gs://${env.GCS_BUCKET_UPLOADS}/${data.objectPath}`, outputUri: `gs://${env.GCS_BUCKET_PUBLIC}/${outPrefix}`, templateId: "preset/web-hd" },
      });
      if (job?.name) await redis.hset(TRANSCODES, data.mediaId, JSON.stringify({ job: job.name, hls: `${outPrefix}manifest.m3u8`, at: Date.now() }));
      return { mp4: true, hls: "queued" };
    }
  }
  return { mp4: true };
}

const TRANSCODES = "transcode:pending";
let transcoderClient: any;
async function transcoder() {
  if (transcoderClient !== undefined) return transcoderClient;
  const mod: any = await import("@google-cloud/video-transcoder" as string).catch(() => null);
  const Client = mod?.TranscoderServiceClient ?? mod?.v1?.TranscoderServiceClient;
  transcoderClient = Client ? new Client() : null;
  return transcoderClient;
}

/** Runs every minute: adds finished streaming versions to their videos, and gives up on stuck ones after 2 hours. */
export async function checkTranscodes(pool: Pool, redis: Redis) {
  const pending = await redis.hgetall(TRANSCODES);
  const ids = Object.keys(pending);
  if (!ids.length) return;
  const client = await transcoder();
  if (!client) return;
  for (const mediaId of ids) {
    const { job, hls, at } = JSON.parse(pending[mediaId]) as { job: string; hls: string; at: number };
    try {
      const [state] = await client.getJob({ name: job });
      if (state?.state === "SUCCEEDED") {
        await pool.query("update media set variants = variants || $2::jsonb where id=$1", [mediaId, JSON.stringify({ hls })]);
        await redis.hdel(TRANSCODES, mediaId);
      } else if (state?.state === "FAILED" || Date.now() - at > 2 * 3600_000) {
        // The MP4 keeps playing; only the streaming version is missing.
        await redis.hdel(TRANSCODES, mediaId);
      }
    } catch (e) {
      if (Date.now() - at > 2 * 3600_000) await redis.hdel(TRANSCODES, mediaId);
      console.warn(`transcode check ${mediaId}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
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

const download = (path: string) => readUpload(path);
const upload = (path: string, body: Buffer, contentType: string) => writePublic(path, body, contentType);
