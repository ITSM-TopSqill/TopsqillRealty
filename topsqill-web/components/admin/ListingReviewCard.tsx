"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { imageUrl, inr, timeAgo, sqft } from "@/lib/format";
import type { Media } from "@/lib/types";

export type ReviewItem = {
  reviewId: string; status: string; risk: "low" | "medium" | "high" | null; submittedAt: string; decidedAt?: string | null;
  checks: { id: string; label: string; ok: boolean; detail?: string }[]; reasons: string[]; note?: string | null;
  listing: { id: string; title: string; purpose: string; kind: string; bhk?: number | null; areaSqft?: number | null; priceInr?: number | null; city: string; locality: string; possession?: string | null; description?: string | null; reraNumber?: string | null; status: string; lat?: number | null; lng?: number | null };
  owner: { id: string; name: string; type: string; kycVerified: boolean; reraVerified: boolean; listingCount: number; createdAt: string; phone?: string | null; email?: string | null };
  media: Media[];
};
const SHORT: Record<string, string> = { photos: "Photos", price: "Price", details: "Details", location: "Location", contact: "Contact info in text", duplicate: "Duplicate", rera: "RERA number", ownership: "Ownership", quality: "Title / description", policy: "Listing rules" };
const RISK = { low: ["Low risk", "#12B76A"], medium: ["Check closely", "#E08A00"], high: ["High risk", "#E5484D"] } as const;

/** One listing in review: photos, details, owner, automatic checks, and the decision with reasons and a note. */
export function ListingReviewCard({ item, reasons }: { item: ReviewItem; reasons: Record<string, string> }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");
  const l = item.listing, o = item.owner;
  const photos = item.media.filter((m) => m.kind === "image");
  const others = item.media.filter((m) => m.kind !== "image");
  const waiting = item.status === "pending";
  // Failed checks suggest the matching reasons.
  const suggested = item.checks.filter((c) => !c.ok).map((c) => (c.id === "owner" ? "ownership" : c.id)).filter((id) => id in reasons);

  async function decide(decision: "approved" | "changes" | "rejected") {
    if (decision !== "approved" && !picked.length && !note.trim()) { setError("Pick at least one reason or write a note, so the owner knows what to fix."); return; }
    setBusy(decision); setError("");
    try {
      await clientApi(`/v1/admin/listings/${l.id}/decide`, { method: "POST", body: { decision, reasons: decision === "approved" ? [] : picked, note: note.trim() || undefined } });
      setDone(decision === "approved" ? "✓ Approved and live. The owner has been told." : decision === "changes" ? "✓ Changes requested. The owner has been told what to fix." : "✓ Rejected. The owner has been told why.");
      setTimeout(() => router.refresh(), 1200);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <article className="card" style={{ overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", gap: 0 }} className="lr-grid">
        <div style={{ background: "var(--chip)" }}>
          {photos[0] ? <img src={imageUrl(photos[0], "large") ?? ""} alt={l.title} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
            : <div style={{ aspectRatio: "4/3", display: "grid", placeItems: "center" }} className="muted small">No photos</div>}
          <div className="row" style={{ gap: 4, padding: 6, overflowX: "auto" }}>
            {photos.slice(1, 8).map((m) => <img key={m.id} src={imageUrl(m, "thumb") ?? ""} alt="" style={{ width: 64, height: 48, objectFit: "cover", borderRadius: 6 }} />)}
            {others.map((m) => <span key={m.id} className="tag" style={{ whiteSpace: "nowrap" }}>{m.kind === "video" ? "▶" : m.kind === "document" ? "📄" : "📐"} {m.label ?? m.kind}</span>)}
          </div>
        </div>
        <div className="pad col" style={{ gap: 10 }}>
          <div className="spread" style={{ alignItems: "flex-start", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 17 }}>{l.title}</b>
              <div className="small muted">{[l.bhk ? `${l.bhk} BHK` : null, l.kind, l.areaSqft ? sqft(l.areaSqft) : null, `${l.locality}, ${l.city}`].filter(Boolean).join(" · ")}</div>
              <div style={{ fontWeight: 800, marginTop: 2 }}>{inr(l.priceInr, l.purpose === "rent")}{l.possession ? <span className="small muted" style={{ fontWeight: 400 }}> · {l.possession}</span> : null}</div>
            </div>
            {item.risk ? <span className="pill" style={{ whiteSpace: "nowrap", color: RISK[item.risk][1], background: `color-mix(in srgb, ${RISK[item.risk][1]} 14%, transparent)` }}>{RISK[item.risk][0]}</span> : null}
          </div>
          {l.description ? <p className="small" style={{ margin: 0, maxHeight: 84, overflow: "auto", whiteSpace: "pre-wrap" }}>{l.description}</p> : null}
          <div className="small" style={{ background: "var(--soft)", borderRadius: 10, padding: "8px 10px" }}>
            <b>{o.name}</b> · {o.type} · {o.kycVerified ? "KYC ✓" : "No KYC"}{o.type === "dealer" || o.type === "builder" ? ` · ${o.reraVerified ? "RERA ✓" : "RERA not verified"}` : ""} · {o.listingCount} listing{o.listingCount === 1 ? "" : "s"} · joined {timeAgo(o.createdAt)}
            {o.phone || o.email ? <div className="muted">{[o.phone, o.email].filter(Boolean).join(" · ")}</div> : null}
          </div>
          <ul className="small" style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 4 }}>
            {item.checks.map((c) => (
              <li key={c.id} title={c.detail}><span style={{ color: c.ok ? "#12B76A" : "#E5484D", fontWeight: 800 }}>{c.ok ? "✓" : "⚠"}</span> {c.label}{c.detail && !c.ok ? <span className="muted"> · {c.detail}</span> : null}</li>
            ))}
          </ul>
          <div className="small muted">
            Submitted {timeAgo(item.submittedAt)}{item.decidedAt ? ` · decided ${timeAgo(item.decidedAt)}` : ""} · <Link href={`/listings/${l.id}`} target="_blank">Preview listing ↗</Link>
          </div>

          {waiting && !done ? (
            <div className="col" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <b className="small">Reasons (shown to the owner if you ask for changes or reject)</b>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {Object.entries(reasons).map(([id, text]) => (
                  <button key={id} type="button" className={`chip${picked.includes(id) ? " on" : ""}`} aria-pressed={picked.includes(id)} title={text}
                    onClick={() => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
                    style={suggested.includes(id) && !picked.includes(id) ? { borderColor: "#E08A00" } : undefined}>
                    {suggested.includes(id) ? "⚠ " : ""}{SHORT[id] ?? text}
                  </button>
                ))}
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
                placeholder="Note for the owner (optional when approving): what to fix, or a word of thanks"
                style={{ width: "100%", border: "1.5px solid var(--line)", borderRadius: 10, padding: 8, font: "inherit", background: "var(--card)" }} />
              <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-g sm" onClick={() => decide("rejected")} disabled={!!busy} style={{ color: "#E5484D" }}>{busy === "rejected" ? "…" : "✕ Reject"}</button>
                <button type="button" className="btn btn-o sm" onClick={() => decide("changes")} disabled={!!busy}>{busy === "changes" ? "…" : "↩ Request changes"}</button>
                <button type="button" className="btn btn-p sm" onClick={() => decide("approved")} disabled={!!busy}>{busy === "approved" ? "…" : "✓ Approve and publish"}</button>
              </div>
            </div>
          ) : null}
          {!waiting && (item.reasons.length || item.note) ? (
            <div className="small" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <b>Told the owner:</b> {[...item.reasons.map((r) => reasons[r] ?? r), item.note].filter(Boolean).join(" · ")}
            </div>
          ) : null}
          {done ? <p className="small" role="status" style={{ margin: 0, color: "var(--vio)", fontWeight: 700 }}>{done}</p> : null}
          {error ? <p className="small error" style={{ margin: 0 }}>{error}</p> : null}
        </div>
      </div>
      <style>{`@media (max-width: 760px){.lr-grid{grid-template-columns:1fr !important}}`}</style>
    </article>
  );
}
