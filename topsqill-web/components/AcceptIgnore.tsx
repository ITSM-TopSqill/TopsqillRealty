"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { refreshCounts } from "./Live";

/** Accept or ignore a connection request. */
export function AcceptIgnore({ peerId }: { peerId: string }) {
  const router = useRouter();
  const [done, setDone] = useState<"accepted" | "ignored" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function respond(action: "accept" | "ignore") {
    setBusy(true); setError("");
    try {
      await clientApi(`/v1/profiles/${peerId}/${action}`, { method: "POST" });
      setDone(action === "accept" ? "accepted" : "ignored");
      refreshCounts();
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (done) return <span className="small muted">{done === "accepted" ? "✓ Connected" : "Ignored"}</span>;
  return (
    <div className="col" style={{ gap: 4, alignItems: "flex-end" }}>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-g sm" onClick={() => respond("ignore")} disabled={busy}>Ignore</button>
        <button className="btn btn-o sm" onClick={() => respond("accept")} disabled={busy}>{busy ? "…" : "Accept"}</button>
      </div>
      {error ? <span className="error small">{error}</span> : null}
    </div>
  );
}
