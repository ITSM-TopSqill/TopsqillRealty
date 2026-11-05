import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/api";

/** Asks the API to send a one-time code. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${API_URL}/v1/auth/otp/request`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
    },
    body: JSON.stringify({ phone: body?.phone }),
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
