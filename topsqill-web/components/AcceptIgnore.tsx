"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

/** Accept or ignore a connection request. */
export function AcceptIgnore({ peerId }: { peerId: string }) {
  const router = useRouter();
  const [done, setDone] = useState<"accepted" | "ignored" | null>(null);
  const [busy, setBusy] = useState(false);

  async function respond(action: "accept" | "ignore") {
    setBusy(true);
    try {
      await clientApi(`/v1/profiles/${peerId}/${action}`, { method: "POST" });
      setDone(action === "accept" ? "accepted" : "ignored");
      router.refresh();
    } finally { setBusy(false); }
  }

  if (done) return <span className="small muted">{done === "accepted" ? "Connected" : "Ignored"}</span>;
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className="btn btn-g sm" onClick={() => respond("ignore")} disabled={busy}>Ignore</button>
      <button className="btn btn-o sm" onClick={() => respond("accept")} disabled={busy}>Accept</button>
    </div>
  );
}
