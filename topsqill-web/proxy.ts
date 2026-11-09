import { NextResponse, type NextRequest } from "next/server";
import { API_URL } from "@/lib/api";
import { ACCESS, REFRESH, REFRESH_MAX_AGE, cookieOptions, secondsLeft, type Tokens } from "@/lib/session-cookies";

/** Renew a little before expiry, so a request never reaches the API with a token that dies in flight. */
const RENEW_WITHIN_SECONDS = 60;

/**
 * Keeps members signed in across page loads.
 *
 * The access cookie lasts 15 minutes and pages only read that one, so without
 * this a reload after 15 minutes looked signed out even though the 30-day
 * refresh cookie was still valid. Before a page or API route runs, this swaps
 * the refresh token for a fresh pair when the access token is missing or about
 * to expire. The new cookies go both onto this request (so the page renders
 * signed in) and onto the response (so the browser keeps them).
 */
export async function proxy(request: NextRequest) {
  const refresh = request.cookies.get(REFRESH)?.value;
  if (!refresh || secondsLeft(request.cookies.get(ACCESS)?.value) > RENEW_WITHIN_SECONDS) return NextResponse.next();

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh, device: request.headers.get("user-agent")?.slice(0, 160) }),
      cache: "no-store",
    });
  } catch {
    // API unreachable: leave the cookies alone and let the page decide.
    return NextResponse.next();
  }

  if (res.ok) {
    const tokens = (await res.json()) as Tokens;
    request.cookies.set(ACCESS, tokens.accessToken);
    request.cookies.set(REFRESH, tokens.refreshToken);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.set(ACCESS, tokens.accessToken, cookieOptions(tokens.expiresIn));
    response.cookies.set(REFRESH, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE));
    return response;
  }

  // The refresh token was refused (expired, revoked, or the account was
  // suspended): the session is over, so drop both cookies. Server errors
  // (5xx) are not a verdict on the session and leave it as it is.
  if (res.status >= 400 && res.status < 500) {
    request.cookies.delete(ACCESS);
    request.cookies.delete(REFRESH);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.delete(ACCESS);
    response.cookies.delete(REFRESH);
    return response;
  }
  return NextResponse.next();
}

export const config = {
  // Pages and the API proxy. Static files, images and the sign-in routes
  // (which set their own cookies) are skipped.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/auth/).*)"],
};
