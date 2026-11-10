"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

/** Launch, pause, resume and end, with the page refreshed after each change. */
export function CampaignActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(path: string, body?: unknown) {
    setBusy(true); setError("");
    try { await clientApi(`/v1/campaigns/${id}/${path}`, { method: "POST", body }); router.refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      {status === "draft" ? <button className="btn btn-ai" disabled={busy} onClick={() => run("launch")}>{busy ? "Launching…" : "🚀 Launch"}</button> : null}
      {status === "active" ? <button className="btn btn-o" disabled={busy} onClick={() => run("status", { status: "paused" })}>Pause</button> : null}
      {status === "paused" ? <button className="btn btn-ai" disabled={busy} onClick={() => run("status", { status: "active" })}>Resume</button> : null}
      {status === "active" || status === "paused"
        ? <button className="btn btn-g" disabled={busy} onClick={() => { if (confirm("End this campaign? It cannot be restarted.")) run("status", { status: "completed" }); }}>End</button>
        : null}
      {error ? <span className="error small">{error}</span> : null}
    </>
  );
}
