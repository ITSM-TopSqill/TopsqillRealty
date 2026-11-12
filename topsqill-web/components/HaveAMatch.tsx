"use client";

import { useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";
import { inr } from "@/lib/format";

type Mine = { id: string; title: string; locality: string; city: string; purpose: string; bhk?: number | null; priceInr?: number | null; score: number };

/**
 * "I have a match": a dealer offers one of their own live listings for a
 * buyer's requirement. The buyer gets a chat message with the home and the
 * dealer's note, and the home joins the requirement's matches.
 */
export function HaveAMatch({ requirementId, signedIn }: { requirementId: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Mine[] | null>(null);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  async function show() {
    if (!signedIn) { window.location.href = `/signin?next=/requirements`; return; }
    setOpen((v) => !v); setError("");
    if (items) return;
    try {
      const r = await clientApi<{ items: Mine[] }>(`/v1/requirements/${requirementId}/my-listings`);
      setItems(r.items); setPick(r.items[0]?.id ?? "");
    } catch (e) { setError((e as Error).message); setItems([]); }
  }
  async function send() {
    setBusy(true); setError("");
    try {
      const r = await clientApi<{ conversationId: string }>(`/v1/requirements/${requirementId}/offer`, { method: "POST", body: { listingId: pick, note: note.trim() || undefined } });
      setSent(r.conversationId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (sent) return <span className="small" style={{ color: "var(--vio)", fontWeight: 700 }}>✓ Sent to the buyer · <Link href="/messages">Open chat</Link></span>;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className="btn btn-ai sm" onClick={show} aria-expanded={open}>🤝 I have a match</button>
      {open ? (
        <div className="card" style={{ position: "absolute", right: 0, top: 40, zIndex: 20, width: "min(420px, calc(100vw - 32px))", padding: 12, boxShadow: "0 12px 32px rgba(20,16,40,.18)" }}>
          {items === null ? <p className="small muted" style={{ margin: 0 }}>Loading your listings…</p>
            : !items.length ? (
              <p className="small" style={{ margin: 0 }}>{error || "You have no live listings yet."} <Link href="/listings/new">Add a listing</Link> to offer it here.</p>
            ) : (
              <>
                <b className="small">Which of your homes fits?</b>
                <div className="col" style={{ gap: 6, marginTop: 8, maxHeight: 240, overflowY: "auto" }}>
                  {items.map((l) => (
                    <label key={l.id} className="row small" style={{ gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                      <input type="radio" name={`m-${requirementId}`} checked={pick === l.id} onChange={() => setPick(l.id)} style={{ marginTop: 3 }} />
                      <span style={{ flex: 1 }}>
                        <b>{l.title}</b><br />
                        <span className="muted">{l.locality}, {l.city} · {inr(l.priceInr, l.purpose === "rent")}</span>
                      </span>
                      <span className="tag" title="How well it fits this requirement">{l.score >= 55 ? `${l.score}% fit` : "Low fit"}</span>
                    </label>
                  ))}
                </div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="A note for the buyer (optional): why it suits them, when they can visit…"
                  style={{ width: "100%", marginTop: 8, border: "1.5px solid var(--line)", borderRadius: 10, padding: 8, font: "inherit", background: "var(--card)" }} />
                <div className="row" style={{ justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                  <button type="button" className="btn btn-g sm" onClick={() => setOpen(false)}>Cancel</button>
                  <button type="button" className="btn btn-p sm" onClick={send} disabled={busy || !pick}>{busy ? "Sending…" : "Send to the buyer"}</button>
                </div>
                {error ? <p className="small error" style={{ margin: "6px 0 0" }}>{error}</p> : null}
              </>
            )}
        </div>
      ) : null}
    </span>
  );
}
