import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { setSession } from "@/lib/session";

/** Checks the code and stores the tokens as httpOnly cookies. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${API_URL}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: body?.phone, code: body?.code, device: req.headers.get("user-agent")?.slice(0, 160) }),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  await setSession(data);
  // The tokens themselves never reach the browser.
  return NextResponse.json({ ok: true, isNew: data.isNew, user: data.user });
}
