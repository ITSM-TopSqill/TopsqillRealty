"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";

type Change = {
  id: string; dimension: string; field: string; currentValue: string; proposedValue: string;
  reason: string; evidence: string; expectedImpact: string; confidence: "low" | "medium" | "high"; risk: string;
};
type Version = { id: string; label: string; summary: string; changes: Change[] };
type Evolution = {
  id: string; source: "claude" | "rules"; status: "proposed" | "applied";
  versions: Version[]; decisions: Record<string, "approved" | "rejected">; appliedCampaignId: string | null;
};
type Outcome =
  | { available: true; verdict: "variant_better" | "original_better" | "inconclusive"; originalCostPerQualifiedLeadInr: number; variantCostPerQualifiedLeadInr: number; percentDifference: number; confidence: "low" | "medium" | "high"; caveat: string }
  | { available: false; reason: string };

const CONFIDENCE_COLOR = { high: "#12B76A", medium: "#E08A00", low: "#8D8AA3" } as const;

/**
 * AI Campaign Evolution (first-party slice): analyse one campaign's own
 * real data, propose redesign versions with the reason/evidence/impact/
 * confidence/risk discipline, let the owner approve or reject each change
 * individually, then turn approved changes into a new draft campaign -
 * never mutating the live one.
 */
export function CampaignEvolution({ campaignId }: { campaignId: string }) {
  const [past, setPast] = useState<Evolution[]>([]);
  const [current, setCurrent] = useState<Evolution | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [appliedLink, setAppliedLink] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    clientApi<{ items: Evolution[] }>(`/v1/campaigns/${campaignId}/evolution`)
      .then((r) => { setPast(r.items); if (r.items[0]) setCurrent(r.items[0]); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => {
    setOutcome(null);
    if (current?.status === "applied") {
      clientApi<Outcome>(`/v1/campaigns/${campaignId}/evolution/${current.id}/outcome`).then(setOutcome).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.status]);

  async function analyse() {
    setAnalysing(true); setError(""); setAppliedLink(null);
    try {
      const evo = await clientApi<Evolution>(`/v1/campaigns/${campaignId}/evolution`, { method: "POST" });
      setCurrent(evo);
      setPast((p) => [evo, ...p]);
    } catch (e) { setError((e as Error).message || "Something went wrong."); }
    finally { setAnalysing(false); }
  }

  async function resolve(changeId: string, status: "approved" | "rejected") {
    if (!current) return;
    try {
      const updated = await clientApi<Evolution>(`/v1/campaigns/${campaignId}/evolution/${current.id}/changes/${changeId}/resolve`, { method: "POST", body: { status } });
      setCurrent(updated);
    } catch (e) { setError((e as Error).message || "Something went wrong."); }
  }

  async function apply(versionId: string) {
    if (!current) return;
    setApplying(versionId); setError("");
    try {
      const r = await clientApi<{ draftCampaignId: string }>(`/v1/campaigns/${campaignId}/evolution/${current.id}/versions/${versionId}/apply`, { method: "POST" });
      setAppliedLink(r.draftCampaignId);
    } catch (e) { setError((e as Error).message || "Something went wrong."); }
    finally { setApplying(null); }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <button type="button" className="btn btn-ai" disabled={analysing} onClick={analyse}>{analysing ? "Analysing…" : "Analyse with AI"}</button>
        {past.length > 1 ? (
          <select value={current?.id ?? ""} onChange={(e) => setCurrent(past.find((p) => p.id === e.target.value) ?? null)}>
            {past.map((p, i) => <option key={p.id} value={p.id}>{i === 0 ? "Latest analysis" : `Analysis ${past.length - i}`}</option>)}
          </select>
        ) : null}
      </div>
      {error ? <p className="error small">{error}</p> : null}
      {appliedLink ? (
        <div className="card pad" style={{ borderLeft: "4px solid #12B76A" }}>
          <b>✅ New draft created</b>
          <p className="small" style={{ marginTop: 4 }}>The approved changes are now a separate draft campaign - nothing changed on the live one. <Link href={`/campaigns/${appliedLink}`}>Review and launch it →</Link></p>
        </div>
      ) : null}

      {!current ? (
        <p className="small muted">No analysis yet. Click &quot;Analyse with AI&quot; to get redesign proposals from this campaign&apos;s own real data.</p>
      ) : (
        <>
          <p className="small muted">{current.source === "claude" ? "AI-generated" : "Rules-based (AI was off, or its proposal didn't pass validation)"}{current.status === "applied" ? " · already applied" : ""}</p>

          {current.status === "applied" ? (
            <div className="card pad">
              <b>Outcome: original vs. variant</b>
              {outcome ? (
                outcome.available ? (
                  <>
                    <p className="small" style={{ marginTop: 6 }}>
                      Original: {outcome.originalCostPerQualifiedLeadInr.toLocaleString("en-IN")}/qualified lead · Variant: {outcome.variantCostPerQualifiedLeadInr.toLocaleString("en-IN")}/qualified lead
                      ({outcome.percentDifference >= 0 ? "+" : ""}{outcome.percentDifference}% on cost)
                    </p>
                    <p className="small" style={{ marginTop: 4, fontWeight: 700 }}>
                      {outcome.verdict === "variant_better" ? "✅ The variant is doing better" : outcome.verdict === "original_better" ? "⚠️ The original is doing better" : "➖ Inconclusive - not a meaningful difference"}
                      {" "}({outcome.confidence} confidence)
                    </p>
                    <p className="small muted" style={{ marginTop: 4 }}>{outcome.caveat}</p>
                  </>
                ) : <p className="small muted" style={{ marginTop: 6 }}>{outcome.reason}</p>
              ) : <p className="small muted" style={{ marginTop: 6 }}>Loading…</p>}
            </div>
          ) : null}
          {current.versions.map((v) => (
            <div key={v.id} className="card pad">
              <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
                <b>{v.label}</b>
                {v.changes.length ? (
                  <button type="button" className="btn btn-ai sm" disabled={applying === v.id || current.status === "applied"} onClick={() => apply(v.id)}>
                    {applying === v.id ? "Applying…" : "Apply approved changes as new draft"}
                  </button>
                ) : null}
              </div>
              <p className="small" style={{ marginTop: 6 }}>{v.summary}</p>

              {v.changes.length ? (
                <div className="col" style={{ gap: 10, marginTop: 10 }}>
                  {v.changes.map((c) => {
                    const decision = current.decisions[c.id];
                    return (
                      <div key={c.id} className="card pad" style={{ background: "var(--soft)", borderLeft: `4px solid ${decision === "approved" ? "#12B76A" : decision === "rejected" ? "#D9668C" : "var(--line)"}` }}>
                        <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
                          <b>{c.field}</b>
                          <span className="pill" style={{ background: `color-mix(in srgb,${CONFIDENCE_COLOR[c.confidence]} 16%,transparent)`, color: CONFIDENCE_COLOR[c.confidence] }}>{c.confidence} confidence</span>
                        </div>
                        <div className="row" style={{ gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                          <div style={{ flex: "1 1 200px" }}><span className="small muted">Current</span><p className="small">{c.currentValue || "—"}</p></div>
                          <div style={{ flex: "1 1 200px" }}><span className="small muted">Proposed</span><p className="small" style={{ fontWeight: 700 }}>{c.proposedValue}</p></div>
                        </div>
                        <p className="small" style={{ marginTop: 6 }}><b>Why:</b> {c.reason}</p>
                        <p className="small muted" style={{ marginTop: 2 }}><b>Evidence:</b> {c.evidence}</p>
                        <p className="small muted" style={{ marginTop: 2 }}><b>Expected impact:</b> {c.expectedImpact}</p>
                        <p className="small muted" style={{ marginTop: 2 }}><b>Risk:</b> {c.risk}</p>
                        <div className="row" style={{ gap: 8, marginTop: 8 }}>
                          <button type="button" className={`chip ${decision === "approved" ? "on" : ""}`} onClick={() => resolve(c.id, "approved")}>Approve</button>
                          <button type="button" className={`chip ${decision === "rejected" ? "on" : ""}`} onClick={() => resolve(c.id, "rejected")}>Reject</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
