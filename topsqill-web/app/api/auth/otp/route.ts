import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { visitorHeaders } from "@/lib/client-ip";

/** Asks the API to send a sign-in or sign-up code by email or to a mobile number. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API_URL}/v1/auth/code/request`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...visitorHeaders(req.headers),
    },
    body: JSON.stringify({ channel: body?.channel, identifier: body?.identifier, intent: body?.intent }),
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
