"use client";

import { useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";

export function Unsubscribe({ u, k, t, label }: { u: string; k: string; t: string; label: string }) {
  const [state, setState] = useState<"ask" | "busy" | "done">("ask");
  const [error, setError] = useState("");
  async function go() {
    setState("busy"); setError("");
    try { await clientApi("/v1/alerts/unsubscribe", { method: "POST", body: { u, k, t } }); setState("done"); }
    catch (e) { setError((e as Error).message); setState("ask"); }
  }
  if (state === "done") {
    return (
      <>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>You&apos;re unsubscribed</h1>
        <p className="muted small">You won&apos;t get {label} any more. You&apos;ll still see these alerts under 🔔 on Topsqill.ai.</p>
        <p className="small">Changed your mind? Turn them back on in <Link href="/settings/alerts">Settings → Alerts</Link>.</p>
      </>
    );
  }
  return (
    <>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Stop {label}?</h1>
      <p className="muted small" style={{ marginBottom: 14 }}>You can turn them back on any time in Settings. Emails about sign-in and payments are always sent.</p>
      {error ? <p role="alert" className="small" style={{ color: "var(--red)" }}>{error}</p> : null}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-ai" onClick={go} disabled={state === "busy"}>{state === "busy" ? "Saving…" : "Unsubscribe"}</button>
        <Link href="/settings/alerts" className="btn btn-g">Choose which emails</Link>
      </div>
    </>
  );
}
