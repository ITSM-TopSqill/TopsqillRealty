import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";

export const metadata = { title: "Business" };
export const dynamic = "force-dynamic";

type Business = {
  id: string; name: string; industryId: string; products: string | null; targetSegments: string | null;
  geographicMarkets: string | null; acquisitionGoals: string | null;
  recommendations: { industry: { label: string }; objectives: string[]; conversionEvents: string[]; dashboardKpis: string[]; sensitive: boolean; complianceNote: string | null };
};
type GenericCampaign = { id: string; name: string; objective: string; conversionEvent: string; budgetInr: number; days: number; status: string };

export default async function BusinessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect(`/signin?next=/business/${id}`);
  const [business, campaigns] = await Promise.all([
    api<Business>(`/v1/business/${id}`, { token }).catch(() => null),
    api<{ items: GenericCampaign[] }>(`/v1/business/${id}/campaigns`, { token }).catch(() => ({ items: [] as GenericCampaign[] })),
  ]);
  if (!business) redirect("/business");

  const r = business.recommendations;
  return (
    <Shell user={user} current="/leads">
      <Link href="/business" className="small muted">← Businesses</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>{business.name}</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>{r.industry.label}</p>

      {r.sensitive ? (
        <div className="card pad" style={{ marginBottom: 16, borderLeft: "4px solid var(--amber,#E08A00)" }}>
          <b>⚠️ Extra ad-policy restrictions apply</b>
          <p className="small" style={{ marginTop: 4 }}>{r.complianceNote}</p>
        </div>
      ) : null}

      <div className="g2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 20 }}>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Recommended objectives</div>
          <p className="small" style={{ marginTop: 4 }}>{r.objectives.join(", ")}</p>
        </div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Conversion events to track</div>
          <p className="small" style={{ marginTop: 4 }}>{r.conversionEvents.join(", ")}</p>
        </div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>This industry's dashboard looks at</div>
          <p className="small" style={{ marginTop: 4 }}>{r.dashboardKpis.join(", ")}</p>
        </div>
      </div>

      <div className="spread" style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 20 }}>Marketing plans</h2>
        <Link href={`/business/${business.id}/campaigns/new`} className="btn btn-ai">+ New plan</Link>
      </div>

      {campaigns.items.length ? (
        <div className="col" style={{ gap: 8 }}>
          {campaigns.items.map((c) => (
            <div key={c.id} className="card pad">
              <b>{c.name}</b> <span className="pill" style={{ marginLeft: 8 }}>{c.status}</span>
              <div className="small muted" style={{ marginTop: 4 }}>{c.objective} · tracking {c.conversionEvent} · ₹{c.budgetInr.toLocaleString("en-IN")} over {c.days} days</div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No marketing plans yet" text="Draft an objective, a conversion event to track, and a budget - matched to this business's industry."
          action={<Link href={`/business/${business.id}/campaigns/new`} className="btn btn-ai">Draft a plan</Link>} />
      )}

      <p className="small muted" style={{ marginTop: 20, maxWidth: "70ch" }}>
        These plans are drafts only - Topsqill doesn&apos;t yet launch non-real-estate campaigns to Meta, Google or any other channel. Real-estate ads still launch from the <Link href="/campaigns">Campaigns</Link> page as before.
      </p>
    </Shell>
  );
}
