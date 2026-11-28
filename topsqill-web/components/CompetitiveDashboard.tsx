"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";
import type { CompetitiveDashboard } from "@/lib/types";

type Business = { id: string; name: string };

/**
 * Competitive Intelligence Dashboard (Module 16, scoped to this feature):
 * a single real-data view across every module already built here -
 * competitors, ad/creative research, market gaps, strategies, creative
 * concepts, draft campaigns and audience strategy. Nothing here is
 * recalculated or invented - every number is read straight from the
 * endpoint that owns it, same discipline as the AI Marketing Command Centre.
 */
export function CompetitiveDashboardView() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [data, setData] = useState<CompetitiveDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clientApi<{ items: Business[] }>("/v1/business").then((r) => { setBusinesses(r.items); if (r.items[0]) setBusinessId(r.items[0].id); }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true); setError("");
    const qs = businessId ? `?businessId=${encodeURIComponent(businessId)}` : "";
    clientApi<CompetitiveDashboard>(`/v1/competitive-intelligence/dashboard${qs}`)
      .then(setData)
      .catch((e) => setError((e as Error).message || "Couldn't load the dashboard right now."))
      .finally(() => setLoading(false));
  }, [businessId]);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card pad">
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {businesses.length ? (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="dash-biz">Business profile</label>
              <select id="dash-biz" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          ) : <p className="small muted">Add a business profile to see its draft campaigns here too.</p>}
        </div>
      </div>

      {error ? <p className="error small">{error}</p> : null}
      {loading && !data ? <p className="small muted">Loading…</p> : null}

      {data ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          <StatCard title="Competitors" href="/competitive-intelligence"
            lines={[
              `${data.competitors.total} tracked`,
              `${data.competitors.accepted} accepted`,
              `${data.competitors.suggested} suggested (pending review)`,
              `${data.competitors.rejected} rejected`,
            ]} />
          <StatCard title="Ad &amp; creative research" href="/competitive-intelligence"
            lines={[`${data.creativeAnalyses.total} analyses saved`]} />
          <ModuleCard title="Market-gap opportunities" href="/market-strategy" tally={data.marketGaps} unit="opportunity" unitPlural="opportunities" />
          <ModuleCard title="Differentiation strategies" href="/market-strategy" tally={data.strategies} unit="strategy" unitPlural="strategies" />
          <ModuleCard title="Creative concepts" href="/market-strategy" tally={data.concepts} unit="concept" unitPlural="concepts" />
          <ModuleCard title="Audience segments" href="/market-strategy" tally={data.audienceStrategies} unit="segment" unitPlural="segments" />
          <StatCard title="Draft campaigns" href={businessId ? `/business/${businessId}` : "/market-strategy"}
            lines={
              "available" in data.campaigns
                ? [data.campaigns.reason]
                : [`${data.campaigns.total} draft campaigns`, `${data.campaigns.fromConcepts} from an approved concept`]
            } />
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ title, href, lines }: { title: string; href: string; lines: string[] }) {
  return (
    <Link href={href} className="card pad" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
      <b className="small">{title}</b>
      <div className="col" style={{ gap: 2, marginTop: 6 }}>
        {lines.map((l, i) => <span key={i} className={i === 0 ? "" : "small muted"} style={i === 0 ? { fontSize: 20, fontWeight: 700 } : undefined}>{l}</span>)}
      </div>
    </Link>
  );
}

function ModuleCard({ title, href, tally, unit, unitPlural }: { title: string; href: string; tally: { batches: number; total: number; approved: number; rejected: number; pending: number }; unit: string; unitPlural: string }) {
  const word = tally.total === 1 ? unit : unitPlural;
  return (
    <Link href={href} className="card pad" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
      <b className="small">{title}</b>
      <div className="col" style={{ gap: 2, marginTop: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{tally.total} {word}</span>
        <span className="small muted">from {tally.batches} {tally.batches === 1 ? "run" : "runs"}</span>
        <span className="small" style={{ color: "#12B76A" }}>{tally.approved} approved</span>
        {tally.pending ? <span className="small" style={{ color: "#B9850A" }}>{tally.pending} awaiting review</span> : null}
        {tally.rejected ? <span className="small muted">{tally.rejected} rejected</span> : null}
      </div>
    </Link>
  );
}
