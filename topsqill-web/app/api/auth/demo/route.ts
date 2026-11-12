import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { setSession } from "@/lib/session";

/** Signs the visitor in to a read-only demo profile, so they can look around before joining. */
export async function POST(req: NextRequest) {
  const res = await fetch(`${API_URL}/v1/auth/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device: req.headers.get("user-agent")?.slice(0, 160) }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  await setSession(data);
  return NextResponse.json({ ok: true });
}
