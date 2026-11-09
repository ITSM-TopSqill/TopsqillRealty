import { cookies } from "next/headers";
import { api } from "./api";
import { ACCESS, REFRESH, REFRESH_MAX_AGE, cookieOptions, type Tokens } from "./session-cookies";

/**
 * Sessions.
 *
 * The access token is short-lived (15 minutes); the refresh token lasts 30
 * days and is single-use. Both are httpOnly cookies, so they never reach
 * JavaScript. proxy.ts renews the access token before any page renders, so a
 * page load never sees an expired session while the refresh token is valid.
 */
export { ACCESS, REFRESH };

export type SessionUser = {
  id: string; name: string; type: string; city?: string | null;
  headline?: string | null; kycVerified?: boolean; reraVerified?: boolean;
  connectionCount?: number; listingCount?: number; isAdmin?: boolean;
  about?: string | null; localities?: string[]; agency?: string | null;
  yearsExperience?: number | null; reraNumber?: string | null;
  avatar?: { urls?: Record<string, string>; blurhash?: string | null } | null;
  cover?: { urls?: Record<string, string> } | null;
};

export async function setSession(tokens: Tokens) {
  const jar = await cookies();
  jar.set(ACCESS, tokens.accessToken, cookieOptions(tokens.expiresIn));
  jar.set(REFRESH, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE));
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
