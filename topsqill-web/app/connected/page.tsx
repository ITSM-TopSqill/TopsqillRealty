"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/** Shown in the pop-up after connecting an account: tells the page that opened it, then closes. */
export default function Connected() {
  const [msg, setMsg] = useState("Connecting…");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const service = q.get("service") ?? "";
    const error = q.get("error");
    setMsg(error ? `Not connected: ${error}` : "Connected. You can close this window.");
    if (window.opener) {
      window.opener.postMessage({ type: "topsqill-connected", service, error }, window.location.origin);
      if (!error) setTimeout(() => window.close(), 600);
    }
  }, []);
  return (
    <main style={{ maxWidth: 420, margin: "80px auto", padding: 16, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
      <p>{msg}</p>
      <p><Link href="/listings/new">Back to Topsqill</Link></p>
    </main>
  );
}
