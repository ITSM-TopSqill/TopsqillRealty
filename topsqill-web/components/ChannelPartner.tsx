"use client";

import { useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";

/**
 * "Become a channel partner": a dealer asks the builder to work with them on
 * this project. The builder gets it as a lead with the dealer's details.
 */
export function ChannelPartner({ projectId, projectName, signedIn }: { projectId: string; projectName: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"sent" | "already" | null>(null);
  const [error, setError] = useState("");

  if (!signedIn) return <Link href={`/signin?next=/projects/${projectId}`} className="btn btn-o">🤝 Become a channel partner</Link>;
  if (done) return <p className="small" style={{ margin: 0, color: "var(--vio)", fontWeight: 700 }}>✓ {done === "sent" ? "Request sent. The builder will get in touch." : "You’ve already asked; the builder has your details."}</p>;
  async function send() {
    setBusy(true); setError("");
    try {
      const r = await clientApi<{ already: boolean }>(`/v1/ai/projects/${projectId}/partner`, { method: "POST", body: { message: msg.trim() || undefined } });
      setDone(r.already ? "already" : "sent");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="col" style={{ gap: 8 }}>
      <button type="button" className="btn btn-o" onClick={() => setOpen((v) => !v)} aria-expanded={open}>🤝 Become a channel partner</button>
      {open ? (
        <div className="card pad" style={{ background: "var(--soft)" }}>
          <p className="small" style={{ margin: "0 0 6px" }}>We’ll send the builder of <b>{projectName}</b> your profile, agency and RERA number, with your note.</p>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} maxLength={600} placeholder="Your experience with similar projects, the buyers you work with, areas you cover…"
            style={{ width: "100%", border: "1.5px solid var(--line)", borderRadius: 10, padding: 8, font: "inherit", background: "var(--card)" }} />
          <div className="row" style={{ justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn-g sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-p sm" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
          </div>
          {error ? <p className="small error" style={{ margin: "6px 0 0" }}>{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
