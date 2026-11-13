"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";

export type DeletionCheck = { canDelete: boolean; blockers: string[]; counts: { listings?: number; posts?: number; leads?: number; connections?: number } };

/**
 * Deleting the account: says exactly what goes and what stays, then asks the
 * member to type DELETE. Anything that must be sorted first (a running ad,
 * money in the wallet) is shown up front instead of failing at the end.
 */
export function DeleteAccount({ check }: { check: DeletionCheck }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const c = check.counts ?? {};
  const n = (v: number | undefined, one: string, many: string) => `${v ?? 0} ${v === 1 ? one : many}`;

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (typed.trim().toUpperCase() !== "DELETE") { setError("Type DELETE to confirm."); return; }
    setBusy(true); setError("");
    try {
      await clientApi("/v1/me/delete", { method: "POST", body: { confirm: "DELETE" } });
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      try { sessionStorage.clear(); localStorage.clear(); } catch { /* storage blocked */ }
      window.location.assign("/signin?deleted=1");
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <div className="card pad" style={{ borderColor: "color-mix(in srgb, var(--red) 35%, var(--line))" }}>
      <h3 style={{ fontSize: 18, margin: "0 0 4px", color: "var(--red)" }}>Delete account</h3>
      <p className="small muted" style={{ margin: "0 0 12px" }}>This is permanent. Your account can&apos;t be brought back, and you&apos;d have to sign up again.</p>

      <div className="da-grid">
        <div>
          <b className="small">What&apos;s deleted</b>
          <ul className="small da-list">
            <li>Your profile, photo and contact details</li>
            <li>{n(c.listings, "listing", "listings")} and {n(c.posts, "post", "posts")}, taken down</li>
            <li>{n(c.connections, "connection", "connections")}, invitations and follows</li>
            <li>{n(c.leads, "lead", "leads")} and your lead sources</li>
            <li>Requirements, job posts, job applications and saved homes</li>
            <li>Connected WhatsApp and Instagram accounts</li>
          </ul>
        </div>
        <div>
          <b className="small">What stays</b>
          <ul className="small da-list">
            <li>Messages you sent stay with the people who got them, shown as from &ldquo;Deleted member&rdquo;</li>
            <li>Payment records and invoices, which tax law requires us to keep, no longer linked to your name</li>
          </ul>
        </div>
      </div>

      {!check.canDelete ? (
        <div role="alert" className="da-block">
          <b className="small">Before you can delete your account:</b>
          <ul className="small da-list" style={{ marginBottom: 0 }}>{check.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      ) : !open ? (
        <button className="btn da-btn" onClick={() => setOpen(true)}>Delete my account…</button>
      ) : (
        <form onSubmit={go} className="col" style={{ gap: 8, marginTop: 6, maxWidth: 420 }}>
          <label htmlFor="del-confirm" className="small"><b>Type DELETE to confirm</b></label>
          <input id="del-confirm" className="sf-text" autoComplete="off" autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" />
          {error ? <p role="alert" className="small" style={{ color: "var(--red)", margin: 0 }}>{error}</p> : null}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-g" onClick={() => { setOpen(false); setTyped(""); setError(""); }}>Cancel</button>
            <button type="submit" className="btn da-btn" disabled={busy || typed.trim().toUpperCase() !== "DELETE"}>{busy ? "Deleting…" : "Delete my account for good"}</button>
          </div>
        </form>
      )}
      <style>{`
        .da-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:12px}
        .da-list{margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px;color:var(--ink2)}
        .da-block{background:color-mix(in srgb, var(--amber) 12%, var(--card));border:1px solid color-mix(in srgb, var(--amber) 40%, var(--line));border-radius:12px;padding:10px 14px}
        .da-btn{background:var(--red);color:#fff;border:0}
        .da-btn:hover{filter:brightness(.95)}
        .da-btn:disabled{opacity:.55}
      `}</style>
    </div>
  );
}
