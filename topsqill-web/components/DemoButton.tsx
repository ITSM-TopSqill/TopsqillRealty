"use client";

import { useState } from "react";

/** "Explore with a demo profile": look around as a demo dealer, read-only, without signing up. */
export function DemoButton({ className = "btn btn-o", label = "👀 Explore with a demo profile", style }: { className?: string; label?: string; style?: React.CSSProperties }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/demo", { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "The demo isn’t available right now.");
      sessionStorage.clear();
      window.location.href = "/";
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button type="button" className={className} style={style} onClick={go} disabled={busy}>{busy ? "Opening the demo…" : label}</button>
      {error ? <span className="small error">{error}</span> : null}
    </span>
  );
}
