import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { RecommendationsList, type Recommendation } from "@/components/RecommendationsList";
import { MarketingAssistant } from "@/components/MarketingAssistant";
import { inr } from "@/lib/format";

export const metadata = { title: "Campaign insights" };
export const dynamic = "force-dynamic";

type Dashboard = {
  campaigns: { id: string; name: string; status: string; spendInr: number; leadsCount: number; qualifiedCount: number }[];
  totals: { spendInr: number; leads: number; qualified: number };
  bestPlatform: { platform: string; costPerQualifiedLeadInr: number } | null;
  bestLocality: { label: string; qualified: number; leads: number } | null;
  bestCampaign: { id: string; name: string; costPerQualifiedLeadInr: number } | null;
  pending: Recommendation[];
};

type ForecastAccuracyRecord = {
  campaignId: string; name: string; forecastQualified: number; forecastCostPerQualifiedLeadInr: number;
  actualQualified: number; actualCostPerQualifiedLeadInr: number | null; qualifiedErrorPct: number; costErrorPct: number | null;
};
type ForecastAccuracy =
  | { available: true; records: ForecastAccuracyRecord[]; averageCostErrorPct: number | null; evaluableCount: number }
  | { available: false; reason: string };

const PLATFORM_NAME: Record<string, string> = { meta: "Facebook and Instagram", google: "Google Search" };

export default async function CampaignInsightsPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin?next=/campaigns/insights");
  const [d, accuracy] = await Promise.all([
    api<Dashboard>("/v1/campaigns/dashboard", { token }).catch(() => null),
    api<ForecastAccuracy>("/v1/campaigns/forecast-accuracy", { token }).catch(() => null),
  ]);
  if (!d) return <Shell user={user} current="/leads"><p className="error">Couldn&apos;t load your campaign insights right now.</p></Shell>;

  const costPerQualified = d.totals.qualified ? Math.round(d.totals.spendInr / d.totals.qualified) : null;
  const running = d.campaigns.filter((c) => c.status === "active" || c.status === "paused").length;

  return (
    <Shell user={user} current="/leads">
      <Link href="/campaigns" className="small muted">← Campaigns</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>Campaign insights</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        Your campaigns&apos; real performance, in one place: what&apos;s working, what&apos;s not, and anything the AI thinks is worth your attention.
        Nothing here changes a live campaign without you approving it.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          ["Campaigns running", String(running)],
          ["Total spend", inr(d.totals.spendInr)],
          ["Leads", String(d.totals.leads)],
          ["Qualified", String(d.totals.qualified)],
          ["Cost per qualified lead", costPerQualified != null ? inr(costPerQualified) : "—"],
        ].map(([k, v], i) => (
          <div key={k} className="card pad" style={i === 3 ? { background: "var(--brand)", color: "#fff", border: 0 } : undefined}>
            <div className="small" style={{ fontWeight: 700, opacity: .85 }}>{k}</div>
            <div style={{ font: '800 22px/1.1 "Bricolage Grotesque",system-ui,sans-serif', marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="g2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 24 }}>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Best-performing platform</div>
          {d.bestPlatform
            ? <><div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{PLATFORM_NAME[d.bestPlatform.platform] ?? d.bestPlatform.platform}</div>
                <div className="small muted">{inr(d.bestPlatform.costPerQualifiedLeadInr)} per qualified lead</div></>
            : <div className="small muted" style={{ marginTop: 4 }}>Not enough data yet.</div>}
        </div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Best-performing area</div>
          {d.bestLocality
            ? <><div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{d.bestLocality.label}</div>
                <div className="small muted">{d.bestLocality.qualified}/{d.bestLocality.leads} leads qualified</div></>
            : <div className="small muted" style={{ marginTop: 4 }}>Not enough data yet.</div>}
        </div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Best-performing campaign</div>
          {d.bestCampaign
            ? <><Link href={`/campaigns/${d.bestCampaign.id}`} style={{ fontSize: 18, fontWeight: 800, marginTop: 4, display: "block" }}>{d.bestCampaign.name}</Link>
                <div className="small muted">{inr(d.bestCampaign.costPerQualifiedLeadInr)} per qualified lead</div></>
            : <div className="small muted" style={{ marginTop: 4 }}>Not enough data yet.</div>}
        </div>
      </div>

      <h2 style={{ fontSize: 20, marginBottom: 10 }}>AI alerts and suggestions</h2>
      <RecommendationsList items={d.pending} />

      <h2 style={{ fontSize: 20, margin: "24px 0 10px" }}>Forecast accuracy</h2>
      <div className="card pad" style={{ marginBottom: 8 }}>
        {accuracy?.available ? (
          <>
            <p className="small">
              Across {accuracy.evaluableCount} completed campaign{accuracy.evaluableCount === 1 ? "" : "s"} with a usable forecast,
              average cost-per-qualified-lead error is {accuracy.averageCostErrorPct != null ? `${accuracy.averageCostErrorPct}%` : "not computable yet"} (how far off the pre-launch forecast was, either direction).
            </p>
            <div className="col" style={{ gap: 6, marginTop: 8 }}>
              {accuracy.records.map((r) => (
                <div key={r.campaignId} className="small muted">
                  {r.name}: forecast {r.forecastQualified} qualified at {inr(r.forecastCostPerQualifiedLeadInr)}/lead → actual {r.actualQualified} qualified
                  {r.actualCostPerQualifiedLeadInr != null ? ` at ${inr(r.actualCostPerQualifiedLeadInr)}/lead` : ""} ({r.qualifiedErrorPct >= 0 ? "+" : ""}{r.qualifiedErrorPct}% on qualified count)
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="small muted">{accuracy?.reason ?? "Not enough completed campaigns yet to evaluate forecast accuracy."}</p>
        )}
      </div>

      <MarketingAssistant />
    </Shell>
  );
}
