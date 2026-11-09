import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { visitorHeaders } from "@/lib/client-ip";
import { getToken, getRefreshToken, setSession, clearSession } from "@/lib/session";

/**
 * Proxy for browser requests.
 *
 * The browser calls /api/proxy/v1/... with no token; this route attaches the
 * httpOnly cookie server-side. If the access token has expired it refreshes
 * once and retries, so members are not signed out mid-action.
 */
export const dynamic = "force-dynamic";

async function forward(req: NextRequest, path: string, token: string | null) {
  const url = new URL(req.url);
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();
  return fetch(`${API_URL}/${path}${url.search}`, {
    method: req.method,
    headers: {
      "content-type": req.headers.get("content-type") ?? "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // The visitor's real IP, for the API's rate limits (never the raw header).
      ...visitorHeaders(req.headers),
    },
    body: body || undefined,
    cache: "no-store",
  });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  let token = await getToken();

  let res = await forward(req, joined, token);

  if (res.status === 401) {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      const refreshed = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      if (refreshed.ok) {
        const tokens = (await refreshed.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
        await setSession(tokens);
        token = tokens.accessToken;
        res = await forward(req, joined, token);
      } else {
        await clearSession();
      }
    }
  }

  const payload = await res.text();
  return new NextResponse(payload || null, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;