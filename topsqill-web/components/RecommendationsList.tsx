"use client";

import Link from "next/link";
import { useState } from "react";
import { clientApi } from "@/lib/api";

export type Recommendation = {
  id: string; campaignId: string; kind: "alert" | "suggestion"; category: string;
  title: string; why: string; impact: string; confidence: "low" | "medium" | "high";
  action: string | null; status: string; createdAt: string;
  // Phase 5 additional requirements, Section 15's full structure:
  diagnosis?: string | null; evidence?: string | null; risk?: string | null; approval?: string | null; priority?: number;
};

const CONFIDENCE_COLOR = { high: "#12B76A", medium: "#E08A00", low: "#8D8AA3" } as const;

/**
 * Phase 5's approval workflow: every alert or suggestion shows what the AI
 * found, why it matters, the expected impact and its confidence, with
 * Approve / Reject / Dismiss - nothing here changes a live campaign on its
 * own (Phase 4's opt-in budget shifting is the one thing that already does).
 */
export function RecommendationsList({ items, showCampaignLink = true }: { items: Recommendation[]; showCampaignLink?: boolean }) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(id: string, status: "approved" | "rejected" | "dismissed") {
    setBusy(id);
    try {
      await clientApi(`/v1/campaigns/recommendations/${id}/resolve`, { method: "POST", body: { status } });
      setRows((r) => r.filter((x) => x.id !== id));
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(null); }
  }

  if (!rows.length) return <p className="small muted">No alerts or suggestions right now.</p>;

  return (
    <div className="col" style={{ gap: 10 }}>
      {rows.map((r) => (
        <div key={r.id} className="card pad" style={{ borderLeft: `4px solid ${r.kind === "alert" ? "#D9668C" : "#6A3FE0"}` }}>
          <div className="spread" style={{ gap: 8, flexWrap: "wrap" }}>
            <b>{r.kind === "alert" ? "⚠️ " : "💡 "}{r.title}</b>
            <span className="pill" style={{ background: `color-mix(in srgb,${CONFIDENCE_COLOR[r.confidence]} 16%,transparent)`, color: CONFIDENCE_COLOR[r.confidence] }}>
              {r.confidence} confidence
            </span>
          </div>
          <p className="small" style={{ marginTop: 6 }}>{r.why}</p>
          {r.diagnosis ? <p className="small muted" style={{ marginTop: 2 }}>Likely cause: {r.diagnosis}</p> : null}
          <p className="small muted" style={{ marginTop: 2 }}>{r.impact}</p>
          {r.action ? <p className="small" style={{ marginTop: 6, fontWeight: 700 }}>Recommended: {r.action}</p> : null}
          {r.risk ? <p className="small muted" style={{ marginTop: 2 }}>Risk: {r.risk}</p> : null}
          {r.approval ? <p className="small muted" style={{ marginTop: 2 }}>Approval: {r.approval}</p> : null}
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ai sm" disabled={!!busy} onClick={() => resolve(r.id, "approved")}>{busy === r.id ? "…" : "Approve"}</button>
            <button type="button" className="btn btn-o sm" disabled={!!busy} onClick={() => resolve(r.id, "rejected")}>Reject</button>
            <button type="button" className="btn btn-g sm" disabled={!!busy} onClick={() => resolve(r.id, "dismissed")}>Dismiss</button>
            {showCampaignLink ? <Link href={`/campaigns/${r.campaignId}`} className="small muted" style={{ marginLeft: "auto" }}>View campaign →</Link> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
