import { cookies } from "next/headers";
import { api } from "./api";

/**
 * Sessions.
 *
 * The access token is short-lived; the refresh token is single-use. Both are
 * httpOnly cookies, so they never reach JavaScript. When the access token
 * expires, the proxy silently refreshes it and retries once.
 */
export const ACCESS = "tq_at";
export const REFRESH = "tq_rt";

export type SessionUser = {
  id: string; name: string; type: string; city?: string | null;
  headline?: string | null; kycVerified?: boolean; reraVerified?: boolean;
  connectionCount?: number; listingCount?: number; isAdmin?: boolean;
  about?: string | null; localities?: string[]; agency?: string | null;
  yearsExperience?: number | null; reraNumber?: string | null;
  avatar?: { urls?: Record<string, string>; blurhash?: string | null } | null;
  cover?: { urls?: Record<string, string> } | null;
};

/**
 * Cookies are marked Secure only when the site is actually served over HTTPS.
 * Deciding this from NODE_ENV instead would break local testing: a production
 * build served over http://localhost would set Secure cookies that Safari
 * refuses to store, so the member would appear signed out straight away.
 */
const isHttps = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

export async function setSession(tokens: { accessToken: string; refreshToken: string; expiresIn: number }) {
  const jar = await cookies();
  const secure = isHttps();
  jar.set(ACCESS, tokens.accessToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: tokens.expiresIn });
  jar.set(REFRESH, tokens.refreshToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(ACCESS);
  jar.delete(REFRESH);
}

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  return (await cookies()).get(REFRESH)?.value ?? null;
}

/** The signed-in member, or null. Safe to call on any page. */
export async function getUser(): Promise<SessionUser | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    return await api<SessionUser>("/v1/me", { token });
  } catch {
    return null;
  }
}
