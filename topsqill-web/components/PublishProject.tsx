"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

export function PublishProject({ id, count }: { id: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function publish() {
    setBusy(true); setError("");
    try {
      await clientApi(`/v1/ai/projects/${id}/publish`, { method: "POST" });
      router.push("/listings");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="card pad row" style={{ gap: 12, marginBottom: 16, flexWrap: "wrap", border: "2px solid var(--vio)" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <b>This is a draft only you can see.</b>
        <div className="small muted">Check the details below. Publishing creates {count} live listing{count === 1 ? "" : "s"}, one per configuration.</div>
        {error ? <div className="error small">{error}</div> : null}
      </div>
      <button className="btn btn-ai" onClick={publish} disabled={busy || !count}>{busy ? "Publishing…" : `Publish ${count} listing${count === 1 ? "" : "s"}`}</button>
    </div>
  );
}
