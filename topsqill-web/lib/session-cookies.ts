/**
 * Session cookie names and options, shared by route handlers (lib/session.ts)
 * and proxy.ts. Kept free of `next/headers` so the proxy can import it.
 */
export const ACCESS = "tq_at";
export const REFRESH = "tq_rt";
export const REFRESH_MAX_AGE = 30 * 24 * 3600;

export type Tokens = { accessToken: string; refreshToken: string; expiresIn: number };

/**
 * Cookies are marked Secure only when the site is actually served over HTTPS.
 * Deciding this from NODE_ENV instead would break local testing: a production
 * build served over http://localhost would set Secure cookies that Safari
 * refuses to store, so the member would appear signed out straight away.
 */
const secure = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

export function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: secure(), sameSite: "lax" as const, path: "/", maxAge };
}

/**
 * Seconds until the access token expires, read from its payload without
 * verifying it (the API verifies every request; this only decides whether to
 * renew early). Missing or unreadable tokens count as expired.
 */
export function secondsLeft(token: string | undefined | null): number {
  if (!token) return 0;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp - Math.floor(Date.now() / 1000) : 0;
  } catch { return 0; }
}
