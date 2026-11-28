"use client";

import { useEffect, useState } from "react";
import { clientApi } from "@/lib/api";
import type { Competitor, MarketGapAnalysis, CompetitiveStrategyBatch, CreativeConceptBatch } from "@/lib/types";

type Business = { id: string; name: string };
const CONFIDENCE_COLOR: Record<string, string> = { high: "#12B76A", medium: "#B9850A", low: "#8D8AA3" };

/**
 * Market Gap Engine (Module 5) + Strategy Generator (Module 6): pick
 * accepted competitors and a business profile, find evidence-grounded
 * opportunities, approve the ones that hold up, then generate 1-3
 * differentiation strategies - optionally building on the approved
 * opportunities. Nothing here launches a campaign; it's analysis the
 * member reviews one decision at a time, same discipline as Campaign
 * Evolution's approve/reject flow.
 */
export function MarketStrategyWorkspace() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [gapBusy, setGapBusy] = useState(false);
  const [gapError, setGapError] = useState("");
  const [gap, setGap] = useState<MarketGapAnalysis | null>(null);

  const [stratBusy, setStratBusy] = useState(false);
  const [stratError, setStratError] = useState("");
  const [strategyBatch, setStrategyBatch] = useState<CompetitiveStrategyBatch | null>(null);

  const [conceptBatches, setConceptBatches] = useState<Record<string, CreativeConceptBatch>>({});
  const [conceptBusyKey, setConceptBusyKey] = useState<string | null>(null);
  const [conceptError, setConceptError] = useState("");

  useEffect(() => {
    clientApi<{ items: Business[] }>("/v1/business").then((r) => { setBusinesses(r.items); if (r.items[0]) setBusinessId(r.items[0].id); }).catch(() => {});
    clientApi<{ items: Competitor[] }>("/v1/competitive-intelligence/competitors").then((r) => setCompetitors(r.items.filter((c) => c.status === "accepted"))).catch(() => {});
  }, []);

  function toggle(id: string) {
    setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else if (next.size < 5) next.add(id); return next; });
  }

  async function findGaps() {
    if (!selected.size) { setGapError("Pick at least one tracked competitor."); return; }
    setGapBusy(true); setGapError(""); setGap(null); setStrategyBatch(null);
    try {
      const row = await clientApi<MarketGapAnalysis>("/v1/competitive-intelligence/market-gaps", {
        method: "POST", body: { businessId: businessId || undefined, competitorIds: [...selected] },
      });
      setGap(row);
    } catch (e) { setGapError((e as Error).message || "Something went wrong."); }
    finally { setGapBusy(false); }
  }

  async function resolveOpportunity(oppId: string, status: "approved" | "rejected") {
    if (!gap) return;
    try {
      const row = await clientApi<MarketGapAnalysis>(`/v1/competitive-intelligence/market-gaps/${gap.id}/opportunities/${oppId}/resolve`, { method: "POST", body: { status } });
      setGap(row);
    } catch (e) { setGapError((e as Error).message || "Something went wrong."); }
  }

  async function generateStrategies() {
    if (!selected.size) { setStratError("Pick at least one tracked competitor."); return; }
    setStratBusy(true); setStratError("");
    try {
      const row = await clientApi<CompetitiveStrategyBatch>("/v1/competitive-intelligence/strategies", {
        method: "POST", body: { businessId: businessId || undefined, competitorIds: [...selected], marketGapAnalysisId: gap?.id },
      });
      setStrategyBatch(row);
    } catch (e) { setStratError((e as Error).message || "Something went wrong."); }
    finally { setStratBusy(false); }
  }

  async function resolveStrategy(stratId: string, status: "approved" | "rejected") {
    if (!strategyBatch) return;
    try {
      const row = await clientApi<CompetitiveStrategyBatch>(`/v1/competitive-intelligence/strategies/${strategyBatch.id}/items/${stratId}/resolve`, { method: "POST", body: { status } });
      setStrategyBatch(row);
    } catch (e) { setStratError((e as Error).message || "Something went wrong."); }
  }

  const approvedGapCount = gap ? Object.values(gap.decisions).filter((d) => d === "approved").length : 0;

  async function generateConceptsFromGap(oppId: string) {
    if (!gap) return;
    setConceptBusyKey(oppId); setConceptError("");
    try {
      const row = await clientApi<CreativeConceptBatch>("/v1/competitive-intelligence/concepts", {
        method: "POST", body: { marketGapAnalysisId: gap.id, opportunityId: oppId },
      });
      setConceptBatches((m) => ({ ...m, [oppId]: row }));
    } catch (e) { setConceptError((e as Error).message || "Something went wrong."); }
    finally { setConceptBusyKey(null); }
  }

  async function generateConceptsFromStrategy(stratId: string) {
    if (!strategyBatch) return;
    setConceptBusyKey(stratId); setConceptError("");
    try {
      const row = await clientApi<CreativeConceptBatch>("/v1/competitive-intelligence/concepts", {
        method: "POST", body: { competitiveStrategyId: strategyBatch.id, strategyItemId: stratId },
      });
      setConceptBatches((m) => ({ ...m, [stratId]: row }));
    } catch (e) { setConceptError((e as Error).message || "Something went wrong."); }
    finally { setConceptBusyKey(null); }
  }

  async function resolveConcept(key: string, batchId: string, conceptId: string, status: "approved" | "rejected") {
    try {
      const row = await clientApi<CreativeConceptBatch>(`/v1/competitive-intelligence/concepts/${batchId}/items/${conceptId}/resolve`, { method: "POST", body: { status } });
      setConceptBatches((m) => ({ ...m, [key]: row }));
    } catch (e) { setConceptError((e as Error).message || "Something went wrong."); }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card pad">
        <b>Market Gap &amp; Strategy</b>
        <p className="small muted" style={{ marginTop: 2 }}>Compare your business against tracked competitors to find real opportunities, then generate differentiation strategies grounded in the evidence.</p>

        <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          {businesses.length ? (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="mg-biz">Business profile</label>
              <select id="mg-biz" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          ) : <p className="small muted">Add a business profile first, so opportunities are grounded in your real positioning.</p>}
        </div>

        {competitors.length ? (
          <div className="col" style={{ gap: 4, marginTop: 10 }}>
            <span className="small muted">Accepted competitors (pick up to 5)</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {competitors.map((c) => (
                <label key={c.id} className="chip" style={{ cursor: "pointer", background: selected.has(c.id) ? "color-mix(in srgb,#6A3FE0 16%,transparent)" : undefined }}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} style={{ marginRight: 6 }} />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        ) : <p className="small muted" style={{ marginTop: 10 }}>No accepted competitors yet - accept at least one on the Competitive Intelligence page first.</p>}

        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ai" disabled={gapBusy || !businessId} onClick={findGaps}>{gapBusy ? "Finding…" : "🔎 Find market-gap opportunities"}</button>
          <button type="button" className="btn btn-o" disabled={stratBusy || !businessId} onClick={generateStrategies} title={gap ? "Builds on this analysis's approved opportunities" : "Generate strategies directly from business + competitors"}>
            {stratBusy ? "Generating…" : "🎯 Generate strategies"}
          </button>
        </div>
        {gapError ? <p className="error small" style={{ marginTop: 8 }}>{gapError}</p> : null}
        {stratError ? <p className="error small" style={{ marginTop: 8 }}>{stratError}</p> : null}
      </div>

      {gap ? (
        <div className="card pad">
          <div className="spread">
            <b>Opportunities</b>
            <span className="small muted">{approvedGapCount} approved</span>
          </div>
          <div className="col" style={{ gap: 10, marginTop: 8 }}>
            {gap.opportunities.map((o) => {
              const decision = gap.decisions[o.id];
              return (
                <div key={o.id} className="card pad" style={{ borderLeft: "4px solid #6A3FE0" }}>
                  <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
                    <b className="small">{o.opportunity}</b>
                    <span className="pill small" style={{ background: `color-mix(in srgb,${CONFIDENCE_COLOR[o.confidence]} 16%,transparent)`, color: CONFIDENCE_COLOR[o.confidence] }}>{o.confidence} confidence</span>
                  </div>
                  <div className="col" style={{ gap: 4, marginTop: 6 }}>
                    <p className="small"><b>Observation</b> — {o.observation}</p>
                    <p className="small"><b>Evidence</b> — {o.evidence}</p>
                    <p className="small"><b>Why it matters</b> — {o.businessRelevance}</p>
                    <p className="small"><b>Suggested campaign</b> — {o.suggestedCampaign}</p>
                    <p className="small"><b>Suggested creative angle</b> — {o.suggestedCreative}</p>
                    <p className="small"><b>Suggested audience</b> — {o.suggestedAudience}</p>
                    <p className="small muted"><b>Risk</b> — {o.risk}</p>
                    <p className="small muted"><b>How to validate cheaply</b> — {o.validationExperiment}</p>
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    <button type="button" className={`btn sm ${decision === "approved" ? "btn-ai" : "btn-g"}`} onClick={() => resolveOpportunity(o.id, "approved")}>{decision === "approved" ? "✓ Approved" : "Approve"}</button>
                    <button type="button" className={`btn sm ${decision === "rejected" ? "btn-ai" : "btn-g"}`} onClick={() => resolveOpportunity(o.id, "rejected")}>{decision === "rejected" ? "✓ Rejected" : "Reject"}</button>
                    {decision === "approved" ? (
                      <button type="button" className="btn btn-o sm" disabled={conceptBusyKey === o.id} onClick={() => generateConceptsFromGap(o.id)}>
                        {conceptBusyKey === o.id ? "Generating…" : "✨ Generate creative concepts"}
                      </button>
                    ) : null}
                  </div>
                  {conceptBatches[o.id] ? <ConceptList batch={conceptBatches[o.id]} onResolve={(cid, status) => resolveConcept(o.id, conceptBatches[o.id].id, cid, status)} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {strategyBatch ? (
        <div className="card pad">
          <b>Strategies</b>
          <div className="col" style={{ gap: 10, marginTop: 8 }}>
            {strategyBatch.strategies.map((s) => {
              const decision = strategyBatch.decisions[s.id];
              return (
                <div key={s.id} className="card pad" style={{ borderLeft: "4px solid #12B76A" }}>
                  <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
                    <b className="small">{s.label}</b>
                    <span className="pill small" style={{ background: `color-mix(in srgb,${CONFIDENCE_COLOR[s.confidence]} 16%,transparent)`, color: CONFIDENCE_COLOR[s.confidence] }}>{s.confidence} confidence</span>
                  </div>
                  <div className="col" style={{ gap: 4, marginTop: 6 }}>
                    <p className="small"><b>Why this fits</b> — {s.rationale}</p>
                    <p className="small"><b>Positioning</b> — {s.positioning}</p>
                    <p className="small"><b>Target segment</b> — {s.targetSegment}</p>
                    <p className="small"><b>Key message</b> — {s.keyMessage}</p>
                    <p className="small"><b>Differentiation</b> — {s.differentiation}</p>
                    <p className="small muted"><b>Risk</b> — {s.risk}</p>
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    <button type="button" className={`btn sm ${decision === "approved" ? "btn-ai" : "btn-g"}`} onClick={() => resolveStrategy(s.id, "approved")}>{decision === "approved" ? "✓ Approved" : "Approve"}</button>
                    <button type="button" className={`btn sm ${decision === "rejected" ? "btn-ai" : "btn-g"}`} onClick={() => resolveStrategy(s.id, "rejected")}>{decision === "rejected" ? "✓ Rejected" : "Reject"}</button>
                    {decision === "approved" ? (
                      <button type="button" className="btn btn-o sm" disabled={conceptBusyKey === s.id} onClick={() => generateConceptsFromStrategy(s.id)}>
                        {conceptBusyKey === s.id ? "Generating…" : "✨ Generate creative concepts"}
                      </button>
                    ) : null}
                  </div>
                  {conceptBatches[s.id] ? <ConceptList batch={conceptBatches[s.id]} onResolve={(cid, status) => resolveConcept(s.id, conceptBatches[s.id].id, cid, status)} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {conceptError ? <p className="error small">{conceptError}</p> : null}
    </div>
  );
}

function ConceptList({ batch, onResolve }: { batch: CreativeConceptBatch; onResolve: (conceptId: string, status: "approved" | "rejected") => void }) {
  return (
    <div className="col" style={{ gap: 8, marginTop: 10 }}>
      {batch.concepts.map((c) => {
        const decision = batch.decisions[c.id];
        return (
          <div key={c.id} className="card pad" style={{ background: "color-mix(in srgb,#6A3FE0 5%,transparent)" }}>
            <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
              <b className="small">{c.angle}</b>
              <span className="pill small" style={{ background: `color-mix(in srgb,${CONFIDENCE_COLOR[c.confidence]} 16%,transparent)`, color: CONFIDENCE_COLOR[c.confidence] }}>{c.format}</span>
            </div>
            <div className="col" style={{ gap: 4, marginTop: 6 }}>
              <p className="small"><b>Headlines</b> — {c.headlines.join(" · ")}</p>
              <p className="small"><b>Primary text</b> — {c.primaryTexts.join(" · ")}</p>
              <p className="small"><b>CTA</b> — {c.ctaVariations.join(" · ")}</p>
              <p className="small muted"><b>Visual idea</b> — {c.visualConcept}</p>
              <p className="small muted"><b>Video idea</b> — {c.videoConcept}</p>
              {c.carouselConcept ? <p className="small muted"><b>Carousel idea</b> — {c.carouselConcept}</p> : null}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <button type="button" className={`btn sm ${decision === "approved" ? "btn-ai" : "btn-g"}`} onClick={() => onResolve(c.id, "approved")}>{decision === "approved" ? "✓ Approved" : "Approve"}</button>
              <button type="button" className={`btn sm ${decision === "rejected" ? "btn-ai" : "btn-g"}`} onClick={() => onResolve(c.id, "rejected")}>{decision === "rejected" ? "✓ Rejected" : "Reject"}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
