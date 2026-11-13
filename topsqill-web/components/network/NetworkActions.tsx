"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { openChat } from "@/components/MessageDock";
import { refreshCounts } from "@/components/Live";

/** Opens a chat with this person (in the dock, or on the Messages page on phones). */
export function MessageButton({ peerId, compact = true }: { peerId: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const c = await clientApi<{ id: string }>(`/v1/conversations/with/${peerId}`, { method: "POST" });
      if (!openChat(c.id)) router.push(`/messages?c=${c.id}`);
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }
  return <button className={`btn btn-o${compact ? " sm" : ""}`} onClick={go} disabled={busy}>{busy ? "Opening…" : "💬 Message"}</button>;
}

/** Takes back an invitation I sent. */
export function WithdrawButton({ peerId, name }: { peerId: string; name: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  async function go() {
    if (!confirm(`Withdraw your invitation to ${name}? You can invite them again later.`)) return;
    setState("busy");
    try { await clientApi(`/v1/profiles/${peerId}/withdraw`, { method: "POST" }); setState("done"); refreshCounts(); router.refresh(); }
    catch (e) { alert((e as Error).message); setState("idle"); }
  }
  if (state === "done") return <span className="small muted">Withdrawn</span>;
  return <button className="btn btn-g sm" onClick={go} disabled={state === "busy"}>{state === "busy" ? "…" : "Withdraw"}</button>;
}

/** The "⋯" menu on a connection: view profile, remove connection. */
export function ConnectionMenu({ peerId, name, onRemoved }: { peerId: string; name: string; onRemoved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setOpen(false);
    if (!confirm(`Remove ${name} from your connections? They won't be told, and you'll stop seeing each other's posts.`)) return;
    setBusy(true);
    try { await clientApi(`/v1/profiles/${peerId}/connection`, { method: "DELETE" }); refreshCounts(); onRemoved?.(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <span style={{ position: "relative" }}>
      <button className="btn btn-g sm" aria-label={`More options for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={busy}>⋯</button>
      {open ? (
        <div className="card nw-menu" role="menu" onMouseLeave={() => setOpen(false)}>
          <a role="menuitem" className="pmi" href={`/profile/${peerId}`}>👤 View profile</a>
          <button role="menuitem" className="pmi" style={{ color: "var(--red)" }} onClick={remove}>✕ Remove connection</button>
        </div>
      ) : null}
    </span>
  );
}
