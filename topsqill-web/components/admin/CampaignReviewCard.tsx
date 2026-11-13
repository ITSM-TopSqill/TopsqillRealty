"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { inr, timeAgo } from "@/lib/format";

export type AdminCampaign = {
  id: string; name: string; status: string; goal: string; budgetInr: number; days: number; platforms: string[]; holdPaise: number; chargedPaise: number; feePct: number;
  submittedAt?: string | null; reviewedAt?: string | null; reviewNote?: string | null; launchedAt?: string | null; endsAt?: string | null; endReason?: string | null;
  creatives?: { headlines?: string[]; primaryTexts?: string[]; googleAd?: { headlines: string[]; descriptions: string[] } } | null;
  leads: number; spendInr: number;
  listingId: string; listingTitle: string; listingStatus: string; city: string; locality: string; priceInr?: number | null; reraNumber?: string | null; possession?: string | null;
  ownerId: string; ownerName: string; ownerType: string; kycVerified: boolean; reraVerified: boolean; phone?: string | null; email?: string | null;
  photos: string[]; deliveries: { platform: string; status: string; error?: string | null; spendPaise: number }[];
};
const rs = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;
const NAME: Record<string, string> = { meta: "Facebook + Instagram", google: "Google Search" };

export function CampaignReviewCard({ c }: { c: AdminCampaign }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const cr = c.creatives ?? {};
  const checks = [
    { ok: c.listingStatus === "active", label: "Listing is live" },
    { ok: c.kycVerified, label: "Owner KYC verified" },
    { ok: !(c.possession === "Under construction") || !!c.reraNumber, label: c.reraNumber ? `RERA ${c.reraNumber}` : "RERA number (under construction)" },
    { ok: c.photos.length > 0, label: `${c.photos.length} photo${c.photos.length === 1 ? "" : "s"} chosen` },
  ];

  async function decide(decision: "approve" | "reject") {
    if (decision === "reject" && !note.trim()) { setError("Write what to change: the member sees it."); return; }
    if (decision === "approve" && !confirm(`Create these ads on Topsqill's ${c.platforms.map((p) => NAME[p] ?? p).join(" and ")} account now? They start spending straight away (up to ${inr(c.budgetInr)} over ${c.days} days).`)) return;
    setBusy(decision); setError("");
    try {
      const r = await clientApi<{ ok: boolean; status: string; results?: { platform: string; status: string; error?: string }[] }>(`/v1/admin/campaigns/${c.id}/decide`, { method: "POST", body: { decision, note: note.trim() || undefined } });
      if (decision === "reject") setDone("✓ Not approved. The money is back in the member's wallet and they've been told why.");
      else if (r.ok) setDone(`✓ Live: ${(r.results ?? []).map((x) => `${NAME[x.platform] ?? x.platform} ${x.status === "live" ? "✓" : `✕ ${x.error ?? ""}`}`).join(" · ")}`);
      else setError(`Couldn't create the ads: ${(r.results ?? []).map((x) => `${NAME[x.platform] ?? x.platform}: ${x.error ?? x.status}`).join(" · ")}. It stays here: fix the setup and approve again.`);
      if (decision === "reject" || r.ok) setTimeout(() => router.refresh(), 1500);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <article className="card pad">
      <div className="spread" style={{ alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 17 }}>{c.name}</b>
          <div className="small muted">{inr(c.budgetInr)} over {c.days} days · {c.platforms.map((p) => NAME[p] ?? p).join(" + ")} · {rs(c.holdPaise)} set aside{c.feePct ? ` (incl. ${c.feePct}% fee)` : ""}</div>
          <div className="small muted">{c.submittedAt ? `Sent ${timeAgo(c.submittedAt)}` : ""}{c.launchedAt ? ` · live since ${timeAgo(c.launchedAt)}` : ""}{c.status !== "review" ? ` · ${c.leads} leads · ${rs(c.chargedPaise)} charged` : ""}{c.endReason ? ` · ${c.endReason}` : ""}</div>
        </div>
        <Link href={`/listings/${c.listingId}`} target="_blank" className="btn btn-g sm">Listing ↗</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginTop: 10 }}>
        <div>
          <div className="row" style={{ gap: 4, overflowX: "auto" }}>
            {c.photos.map((p) => <img key={p} src={p} alt="" style={{ width: 96, height: 72, objectFit: "cover", borderRadius: 8 }} />)}
          </div>
          <div className="small" style={{ marginTop: 6 }}><b>{c.listingTitle}</b> · {c.locality}, {c.city}{c.priceInr ? ` · ${inr(c.priceInr)}` : ""}</div>
          <div className="small" style={{ background: "var(--soft)", borderRadius: 8, padding: "6px 8px", marginTop: 6 }}>
            <b>{c.ownerName}</b> · {c.ownerType}{c.phone || c.email ? ` · ${[c.phone, c.email].filter(Boolean).join(" · ")}` : ""}
          </div>
          <ul className="small" style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
            {checks.map((x) => <li key={x.label}><span style={{ color: x.ok ? "#12B76A" : "#E5484D", fontWeight: 800 }}>{x.ok ? "✓" : "⚠"}</span> {x.label}</li>)}
          </ul>
        </div>
        <div className="small">
          <b>Ad text</b>
          {cr.headlines?.length ? <div style={{ marginTop: 4 }}><span className="muted">Headline:</span> {cr.headlines[0]}</div> : null}
          {cr.primaryTexts?.length ? <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}><span className="muted">Text:</span> {cr.primaryTexts[0]}</div> : null}
          {c.platforms.includes("google") && cr.googleAd ? <div style={{ marginTop: 4 }}><span className="muted">Google:</span> {cr.googleAd.headlines.slice(0, 3).join(" | ")}</div> : null}
          {c.deliveries.length ? (
            <div style={{ marginTop: 8 }}>
              {c.deliveries.map((d, i) => <div key={i}>{NAME[d.platform] ?? d.platform}: <b>{d.status}</b>{d.spendPaise ? ` · ${rs(d.spendPaise)}` : ""}{d.error ? <span className="error"> · {d.error}</span> : null}</div>)}
            </div>
          ) : null}
          {c.reviewNote ? <div style={{ marginTop: 6 }}><span className="muted">Note:</span> {c.reviewNote}</div> : null}
        </div>
      </div>

      {c.status === "review" && !done ? (
        <div className="col" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Note for the member (required to reject): what to change in the text or photos"
            style={{ width: "100%", border: "1.5px solid var(--line)", borderRadius: 10, padding: 8, font: "inherit", background: "var(--card)" }} />
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-g sm" style={{ color: "#E5484D" }} disabled={!!busy} onClick={() => decide("reject")}>{busy === "reject" ? "…" : "✕ Not approved"}</button>
            <button className="btn btn-p sm" disabled={!!busy} onClick={() => decide("approve")}>{busy === "approve" ? "Creating the ads…" : "✓ Approve and go live"}</button>
          </div>
        </div>
      ) : null}
      {done ? <p className="small" role="status" style={{ color: "var(--vio)", fontWeight: 700, margin: "8px 0 0" }}>{done}</p> : null}
      {error ? <p className="small error" role="alert" style={{ margin: "8px 0 0" }}>{error}</p> : null}
    </article>
  );
}
