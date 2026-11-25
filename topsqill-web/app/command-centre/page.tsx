import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { RecommendationsList, type Recommendation } from "@/components/RecommendationsList";
import { inr } from "@/lib/format";

export const metadata = { title: "Command Centre" };
export const dynamic = "force-dynamic";

type Overview = {
  businessOverview: {
    campaignsRunning: number; campaignsTotal: number; totalSpendInr: number; totalLeads: number; totalQualified: number;
    bestPlatform: { platform: string; costPerQualifiedLeadInr: number } | null;
    bestLocality: { label: string; qualified: number; leads: number } | null;
    bestCampaign: { id: string; name: string; costPerQualifiedLeadInr: number } | null;
  };
  forecastAccuracy: { available: true; averageCostErrorPct: number | null; evaluableCount: number } | { available: false; reason: string };
  growthOpportunities: Recommendation[];
  approvalCentre: { pendingRecommendations: number; pendingEvolutionChanges: number };
  aiActivity: { recommendationsPending: number; evolutionAnalysesRun: number; evolutionVersionsApplied: number };
  integrations: { connectedCount: number; totalCount: number; details: { id: string; name: string; kind: string; status: string }[] };
  nonRealEstateBusinesses: { count: number; items: { id: string; name: string; industry: string }[] };
  customerSegments: { count: number; items: { id: string; name: string }[] };
};

const PLATFORM_NAME: Record<string, string> = { meta: "Facebook and Instagram", google: "Google Search" };

export default async function CommandCentrePage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin?next=/command-centre");
  const o = await api<Overview>("/v1/command-centre", { token }).catch(() => null);
  if (!o) return <Shell user={user} current="/leads"><p className="error">Couldn&apos;t load the Command Centre right now.</p></Shell>;

  const b = o.businessOverview;
  const costPerQualified = b.totalQualified ? Math.round(b.totalSpendInr / b.totalQualified) : null;

  return (
    <Shell user={user} current="/leads">
      <Link href="/campaigns" className="small muted">← Campaigns</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>AI Marketing Command Centre</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        One real-data view across your campaigns, AI recommendations, forecast accuracy, integrations, non-real-estate businesses and CRM segments. Every number here is read straight from the page that owns it - nothing is recalculated or invented.
      </p>

      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Business overview</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          ["Campaigns running", `${b.campaignsRunning} of ${b.campaignsTotal}`],
          ["Total spend", inr(b.totalSpendInr)],
          ["Leads", String(b.totalLeads)],
          ["Qualified", String(b.totalQualified)],
          ["Cost per qualified lead", costPerQualified != null ? inr(costPerQualified) : "—"],
        ].map(([k, v], i) => (
          <div key={k} className="card pad" style={i === 3 ? { background: "var(--brand)", color: "#fff", border: 0 } : undefined}>
            <div className="small" style={{ fontWeight: 700, opacity: .85 }}>{k}</div>
            <div style={{ font: '800 20px/1.1 "Bricolage Grotesque",system-ui,sans-serif', marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="g2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 20 }}>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Best-performing platform</div>
          {b.bestPlatform ? <div className="small" style={{ marginTop: 4 }}>{PLATFORM_NAME[b.bestPlatform.platform] ?? b.bestPlatform.platform} · {inr(b.bestPlatform.costPerQualifiedLeadInr)}/qualified</div> : <div className="small muted" style={{ marginTop: 4 }}>Not enough data yet.</div>}
        </div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Best-performing area</div>
          {b.bestLocality ? <div className="small" style={{ marginTop: 4 }}>{b.bestLocality.label} · {b.bestLocality.qualified}/{b.bestLocality.leads} qualified</div> : <div className="small muted" style={{ marginTop: 4 }}>Not enough data yet.</div>}
        </div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Forecast accuracy</div>
          {o.forecastAccuracy.available
            ? <div className="small" style={{ marginTop: 4 }}>{o.forecastAccuracy.averageCostErrorPct != null ? `${o.forecastAccuracy.averageCostErrorPct}% avg error` : "not computable yet"} across {o.forecastAccuracy.evaluableCount} campaign(s)</div>
            : <div className="small muted" style={{ marginTop: 4 }}>{o.forecastAccuracy.reason}</div>}
        </div>
      </div>

      <div className="g2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 24 }}>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Approval Centre</div>
          <div className="small" style={{ marginTop: 4 }}>{o.approvalCentre.pendingRecommendations} recommendation(s) · {o.approvalCentre.pendingEvolutionChanges} evolution change(s) awaiting your decision</div>
        </div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>AI Activity</div>
          <div className="small" style={{ marginTop: 4 }}>{o.aiActivity.evolutionAnalysesRun} campaign analysis run(s) · {o.aiActivity.evolutionVersionsApplied} applied as drafts</div>
        </div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Integrations</div>
          <div className="small" style={{ marginTop: 4 }}>{o.integrations.connectedCount} of {o.integrations.totalCount} verified connected</div>
          <Link href="/competitive-intelligence" className="small muted" style={{ display: "block", marginTop: 2 }}>See all →</Link>
        </div>
      </div>

      <div className="g2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 24 }}>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Non-real-estate businesses</div>
          <div className="small" style={{ marginTop: 4 }}>{o.nonRealEstateBusinesses.count}</div>
          <Link href="/business" className="small muted" style={{ display: "block", marginTop: 2 }}>Manage →</Link>
        </div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>CRM segments</div>
          <div className="small" style={{ marginTop: 4 }}>{o.customerSegments.count}</div>
          <Link href="/customer-intelligence" className="small muted" style={{ display: "block", marginTop: 2 }}>Manage →</Link>
        </div>
      </div>

      <h2 style={{ fontSize: 18, marginBottom: 10 }}>Growth opportunities (top 5 by priority)</h2>
      <RecommendationsList items={o.growthOpportunities} />
    </Shell>
  );
}
