import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getToken } from "@/lib/session";

/** Facebook sends the member back here after they allow Topsqill; the API finishes connecting. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const done = (error?: string) => NextResponse.redirect(new URL(`/connected?service=facebook${error ? `&error=${encodeURIComponent(error)}` : ""}`, req.url));
  if (q.get("error")) return done(q.get("error_description") || "Facebook wasn’t connected.");
  const code = q.get("code"), state = q.get("state");
  if (!code || !state) return done("Facebook didn’t send a sign-in code.");
  const token = await getToken();
  if (!token) return done("Please sign in to Topsqill first, then connect Facebook again.");
  try {
    await api("/v1/facebook/callback", { method: "POST", token, body: { code, state } });
    return done();
  } catch (e) {
    return done((e as Error).message);
  }
}
