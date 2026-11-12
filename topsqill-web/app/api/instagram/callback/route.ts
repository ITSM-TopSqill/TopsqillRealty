import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getToken } from "@/lib/session";

/** Instagram sends the member back here after they allow Topsqill; the API finishes connecting. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const done = (error?: string) => NextResponse.redirect(new URL(`/connected?service=instagram${error ? `&error=${encodeURIComponent(error)}` : ""}`, req.url));
  if (q.get("error")) return done(q.get("error_description") || "Instagram wasn’t connected.");
  const code = q.get("code"), state = q.get("state");
  if (!code || !state) return done("Instagram didn’t send a sign-in code.");
  const token = await getToken();
  if (!token) return done("Please sign in to Topsqill first, then connect Instagram again.");
  try {
    await api("/v1/instagram/callback", { method: "POST", token, body: { code, state } });
    return done();
  } catch (e) {
    return done((e as Error).message);
  }
}
