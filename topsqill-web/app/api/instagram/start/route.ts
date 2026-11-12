import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getToken } from "@/lib/session";

/** Opens Instagram's login so a member can connect their own account (in a small pop-up window). */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = await getToken();
  if (!token) return NextResponse.redirect(new URL("/signin", req.url));
  try {
    const { url } = await api<{ url: string }>("/v1/instagram/authorize", { token });
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.redirect(new URL(`/connected?service=instagram&error=${encodeURIComponent((e as Error).message)}`, req.url));
  }
}
