import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks Meta's `X-Hub-Signature-256` header (used by lead ads and WhatsApp).
 *
 * The HMAC is over the exact bytes Meta sent, so `raw` must be the original
 * request body, never a re-serialised copy of the parsed JSON.
 *
 * Without an app secret the check passes only outside production, so local
 * testing works but a misconfigured production service fails closed.
 */
export function verifyMetaSignature(
  raw: Buffer | undefined,
  header: string | string[] | undefined,
  appSecret: string | undefined,
  production: boolean,
): SignatureCheck {
  if (!appSecret) return production ? { ok: false, reason: "webhook secret not configured" } : { ok: true };
  if (!raw) return { ok: false, reason: "missing body" };
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("sha256=")) return { ok: false, reason: "missing signature" };
  const expected = Buffer.from("sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex"));
  const given = Buffer.from(value);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}
