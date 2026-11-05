import { NextResponse } from "next/server";
import { API_URL } from "@/lib/api";
import { getRefreshToken, clearSession } from "@/lib/session";

export async function POST() {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    await fetch(`${API_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    }).catch(() => {});
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}
