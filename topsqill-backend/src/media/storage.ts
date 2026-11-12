import { Storage } from "@google-cloud/storage";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { env } from "../common/env";

/**
 * Where files live. On Google Cloud: originals in the private uploads bucket,
 * processed photos in the public media bucket. Locally (no GCP_PROJECT_ID), a
 * folder on disk served by the API, so uploads work in development too.
 * Shared by the API and the worker.
 */
const gcs = env.GCP_PROJECT_ID && env.GCS_BUCKET_UPLOADS && env.GCS_BUCKET_PUBLIC ? new Storage({ projectId: env.GCP_PROJECT_ID }) : null;
export const isLocalStorage = !gcs;

const apiBase = () => (env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, "");
const root = () => resolve(env.LOCAL_MEDIA_DIR);

/** Resolves a stored path inside the local folder, refusing anything that escapes it. */
export function localPath(area: "uploads" | "public", path: string) {
  const base = join(root(), area);
  const full = resolve(base, path);
  if (!full.startsWith(base + sep)) throw new Error("Invalid path");
  return full;
}

/** Signs local links with the app secret, so only links the API issued work. */
export function sign(value: string) {
  return createHmac("sha256", env.JWT_SECRET).update(value).digest("base64url");
}
export function checkSignature(value: string, sig: string) {
  const want = Buffer.from(sign(value));
  const got = Buffer.from(String(sig));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Base for public file links in API responses. */
export function publicBase() {
  if (env.CDN_BASE_URL) return env.CDN_BASE_URL.replace(/\/$/, "");
  return gcs ? `https://storage.googleapis.com/${env.GCS_BUCKET_PUBLIC}` : `${apiBase()}/v1/media/local/public`;
}

/** A link the browser can PUT the file to directly, valid for 15 minutes. */
export async function uploadUrl(mediaId: string, objectPath: string, contentType: string) {
  if (gcs) {
    const [url] = await gcs.bucket(env.GCS_BUCKET_UPLOADS!).file(objectPath).getSignedUrl({
      version: "v4", action: "write", expires: Date.now() + 15 * 60 * 1000, contentType,
    });
    return url;
  }
  const exp = Date.now() + 15 * 60 * 1000;
  return `${apiBase()}/v1/media/${mediaId}/local-upload?exp=${exp}&sig=${sign(`up:${mediaId}:${exp}`)}`;
}

/** A short-lived link to read a private original (verification documents). */
export async function privateReadUrl(objectPath: string, minutes = 15) {
  if (gcs) {
    const [url] = await gcs.bucket(env.GCS_BUCKET_UPLOADS!).file(objectPath).getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + minutes * 60 * 1000,
    });
    return url;
  }
  const exp = Date.now() + minutes * 60 * 1000;
  return `${apiBase()}/v1/media/local/private?path=${encodeURIComponent(objectPath)}&exp=${exp}&sig=${sign(`read:${objectPath}:${exp}`)}`;
}

export async function saveLocalUpload(objectPath: string, body: Buffer) {
  const full = localPath("uploads", objectPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, body);
}

/** Saves an original the server fetched itself (an imported photo) where browser uploads go. */
export async function writeUpload(objectPath: string, body: Buffer, contentType: string) {
  if (gcs) { await gcs.bucket(env.GCS_BUCKET_UPLOADS!).file(objectPath).save(body, { contentType, resumable: false }); return; }
  await saveLocalUpload(objectPath, body);
}

export async function readUpload(objectPath: string): Promise<Buffer> {
  if (gcs) { const [buf] = await gcs.bucket(env.GCS_BUCKET_UPLOADS!).file(objectPath).download(); return buf; }
  return readFile(localPath("uploads", objectPath));
}

export async function writePublic(path: string, body: Buffer, contentType: string) {
  if (gcs) {
    await gcs.bucket(env.GCS_BUCKET_PUBLIC!).file(path).save(body, {
      contentType,
      // Files never change once written, so browsers and the CDN can keep them for a year.
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });
    return;
  }
  const full = localPath("public", path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, body);
}

export async function copyToPublic(from: string, to: string) {
  if (gcs) {
    await gcs.bucket(env.GCS_BUCKET_UPLOADS!).file(from).copy(gcs.bucket(env.GCS_BUCKET_PUBLIC!).file(to));
    return;
  }
  const dest = localPath("public", to);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(localPath("uploads", from), dest);
}

export async function readLocal(area: "uploads" | "public", path: string) {
  return readFile(localPath(area, path));
}
