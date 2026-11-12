"use client";

import { useState } from "react";

/** Share a profile: WhatsApp, copy link, or the phone's share sheet. */
export function ShareProfile({ id, name, headline }: { id: string; name: string; headline?: string | null }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const url = () => `${window.location.origin}/profile/${id}`;
  const text = () => `${name}${headline ? `, ${headline}` : ""} on Topsqill.ai`;
  const flash = (t: string) => { setNote(t); setTimeout(() => setNote(""), 2200); };
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className="btn btn-o" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">↗ Share profile</button>
      {open ? (
        <div className="card" role="menu" style={{ position: "absolute", right: 0, top: 46, zIndex: 5, minWidth: 190, padding: 4 }}>
          <button role="menuitem" className="pmi" onClick={() => { setOpen(false); window.open(`https://wa.me/?text=${encodeURIComponent(`${text()}\n${url()}`)}`, "_blank", "noopener,noreferrer"); }}>🟢 Share on WhatsApp</button>
          <button role="menuitem" className="pmi" onClick={async () => { setOpen(false); try { await navigator.clipboard.writeText(url()); flash("Link copied"); } catch { flash("Couldn’t copy"); } }}>🔗 Copy link</button>
          <button role="menuitem" className="pmi" onClick={async () => { setOpen(false); try { if (navigator.share) await navigator.share({ title: name, text: text(), url: url() }); } catch { /* closed */ } }}>↗ More options</button>
        </div>
      ) : null}
      {note ? <span className="small" role="status" style={{ position: "absolute", top: 48, right: 0, color: "var(--vio)", fontWeight: 700, whiteSpace: "nowrap" }}>{note}</span> : null}
    </span>
  );
}
