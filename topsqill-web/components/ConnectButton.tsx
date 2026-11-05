"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

/** Connect, or message once connected. The state updates without a reload. */
export function ConnectButton({ peerId, relation, signedIn }: {
  peerId: string; relation: "self" | "connected" | "pending" | "none"; signedIn: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(relation);
  const [busy, setBusy] = useState(false);

  if (!signedIn) return <Link href="/signin" className="btn btn-ai">Sign in to connect</Link>;
  if (state === "self") return null;

  async function connect() {
    setBusy(true);
    try { await clientApi(`/v1/profiles/${peerId}/connect`, { method: "POST" }); setState("pending"); }
    finally { setBusy(false); }
  }

  async function message() {
    setBusy(true);
    try {
      const convo = await clientApi<{ id: string }>(`/v1/conversations/with/${peerId}`, { method: "POST" });
      router.push(`/messages?c=${convo.id}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="row">
      {state === "none" ? <button className="btn btn-o" onClick={connect} disabled={busy}>+ Connect</button> : null}
      {state === "pending" ? <span className="btn btn-g" aria-live="polite">Invitation sent</span> : null}
      <button className="btn btn-p" onClick={message} disabled={busy}>💬 Message</button>
    </div>
  );
}
