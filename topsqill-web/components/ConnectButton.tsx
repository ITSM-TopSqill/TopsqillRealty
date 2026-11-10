"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { openChat } from "./MessageDock";
import { refreshCounts } from "./Live";

export type Relation = "self" | "connected" | "pending" | "incoming" | "none";

/**
 * Connect, accept an invitation, or message. Every state change shows on the
 * button at once, and errors are shown rather than silently ignored.
 */
export function ConnectButton({ peerId, relation, signedIn, compact = false }: {
  peerId: string; relation: Relation; signedIn: boolean; compact?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<Relation>(relation);
  const [busy, setBusy] = useState<"connect" | "accept" | "ignore" | "message" | null>(null);
  const [error, setError] = useState("");
  const sm = compact ? " sm" : "";

  if (!signedIn) return <Link href="/signin" className={`btn btn-ai${sm}`}>Sign in to connect</Link>;
  if (state === "self") return null;

  async function run(kind: "connect" | "accept" | "ignore") {
    setBusy(kind); setError("");
    try {
      const res = await clientApi<{ status: string }>(`/v1/profiles/${peerId}/${kind}`, { method: "POST" });
      setState(res.status === "connected" || res.status === "accepted" ? "connected" : res.status === "ignored" ? "none" : "pending");
      refreshCounts();
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function message() {
    setBusy("message"); setError("");
    try {
      const convo = await clientApi<{ id: string }>(`/v1/conversations/with/${peerId}`, { method: "POST" });
      if (openChat(convo.id)) setBusy(null); else router.push(`/messages?c=${convo.id}`);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }

  return (
    <div className="col" style={{ gap: 6, alignItems: compact ? "stretch" : "flex-end" }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {state === "none" ? <button className={`btn btn-o${sm}`} onClick={() => run("connect")} disabled={!!busy}>{busy === "connect" ? "Sending…" : "+ Connect"}</button> : null}
        {state === "pending" ? <span className={`btn btn-g${sm}`} aria-live="polite">✓ Invitation sent</span> : null}
        {state === "incoming" ? (
          <>
            <button className={`btn btn-ai${sm}`} onClick={() => run("accept")} disabled={!!busy}>{busy === "accept" ? "Accepting…" : "Accept invitation"}</button>
            <button className={`btn btn-g${sm}`} onClick={() => run("ignore")} disabled={!!busy}>Ignore</button>
          </>
        ) : null}
        {state === "connected" && !compact ? <span className={`btn btn-g${sm}`}>✓ Connected</span> : null}
        {!compact || state === "connected" ? (
          <button className={`btn btn-p${sm}`} onClick={message} disabled={!!busy}>{busy === "message" ? "Opening…" : "💬 Message"}</button>
        ) : null}
      </div>
      {error ? <span className="error small" role="alert">{error}</span> : null}
    </div>
  );
}
