"use client";

import Link from "next/link";

/** Shown on every page while exploring the demo profile. */
export function DemoBanner() {
  async function exit() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    sessionStorage.clear();
    window.location.href = "/signup";
  }
  return (
    <div role="status" style={{ background: "linear-gradient(90deg,#7B3DFF,#E5487A)", color: "#fff", padding: "8px 16px", textAlign: "center", fontSize: 14, fontWeight: 600 }}>
      👀 You’re exploring a demo profile. Look around freely: posting, messaging and saving are off.{" "}
      <button type="button" onClick={exit} style={{ background: "#fff", color: "#3A1E8F", border: 0, borderRadius: 999, padding: "3px 12px", fontWeight: 800, cursor: "pointer", marginLeft: 6 }}>Create my free account</button>{" "}
      <Link href="/" style={{ color: "#fff", textDecoration: "underline", marginLeft: 6 }} onClick={async (e) => { e.preventDefault(); await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); window.location.href = "/"; }}>Exit demo</Link>
    </div>
  );
}
