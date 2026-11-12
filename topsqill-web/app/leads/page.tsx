import Link from "next/link";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { inr } from "@/lib/format";
import { Empty } from "@/components/ui";
import { LeadBoard } from "@/components/LeadBoard";
import { redirect } from "next/navigation";
import type { Lead } from "@/lib/types";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin");

  const [board, stats] = await Promise.all([
    api<{ columns: Record<string, Lead[]>; total: number }>("/v1/leads", { token }).catch(() => ({ columns: {}, total: 0 })),
    api<{ last7Days: number; qualified: number; booked: number; averageScore: number; total: number; bySource: { source: string; n: number }[];
      response?: { medianMinutes: number | null; withinHourPct: number | null; waiting: number };
      cost?: { spendInr: number; perLead: number | null; perQualifiedLead: number | null; campaignLeads: number } }>(
      "/v1/leads/stats", { token }).catch(() => null),
  ]);

  return (
    <Shell user={user} current="/leads">
      <div className="spread" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Leads</h1>
          <p className="muted small">Every enquiry from ads, portals, WhatsApp and Topsqill.ai lands here.</p>
        </div>
        <div className="row">
          <Link href="/leads/sources" className="btn btn-o">Connect sources</Link>
          <Link href="/campaigns" className="btn btn-ai">Campaigns</Link>
        </div>
      </div>

      {stats ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 16 }}>
          {[
            ["Leads this week", stats.last7Days, "var(--brand)"],
            ["Qualified", stats.qualified, "linear-gradient(115deg,#E5484D,#E08A00)"],
            ["Booked", stats.booked, "linear-gradient(115deg,#2E9E90,#2F7FE6)"],
            ["Average score", stats.averageScore, "linear-gradient(115deg,#8B4FEA,#E5487A)"],
          ].map(([label, value, bg]) => (
            <div key={String(label)} className="card pad" style={{ background: bg as string, color: "#fff", border: 0 }}>
              <div className="small" style={{ fontWeight: 700, opacity: .92 }}>{label as string}</div>
              <div style={{ font: '800 28px/1 "Bricolage Grotesque", system-ui, sans-serif', marginTop: 6 }}>{value as number}</div>
            </div>
          ))}
          <div className="card pad" title="From a lead arriving to your team's first call, message, note or stage change (last 90 days)">
            <div className="small muted" style={{ fontWeight: 700 }}>First response</div>
            <div style={{ font: '800 28px/1 "Bricolage Grotesque", system-ui, sans-serif', marginTop: 6 }}>{minutes(stats.response?.medianMinutes)}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {stats.response?.withinHourPct != null ? `${stats.response.withinHourPct}% within an hour` : "median"}{stats.response?.waiting ? ` · ${stats.response.waiting} waiting` : ""}
            </div>
          </div>
          <div className="card pad" title="What your campaigns spent, divided by the leads they brought">
            <div className="small muted" style={{ fontWeight: 700 }}>Cost per lead</div>
            <div style={{ font: '800 28px/1 "Bricolage Grotesque", system-ui, sans-serif', marginTop: 6 }}>{stats.cost?.perLead != null ? inr(stats.cost.perLead) : "—"}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {stats.cost?.campaignLeads ? `${inr(stats.cost.spendInr)} for ${stats.cost.campaignLeads} campaign lead${stats.cost.campaignLeads === 1 ? "" : "s"}${stats.cost.perQualifiedLead != null ? ` · ${inr(stats.cost.perQualifiedLead)} per qualified` : ""}` : "No campaign spend yet"}
            </div>
          </div>
        </div>
      ) : null}

      {board.total
        ? <LeadBoard columns={board.columns} />
        : <Empty title="No leads yet" text="Connect a lead source, or run a campaign, and new enquiries will appear here automatically."
            action={<Link href="/leads/sources" className="btn btn-ai">Connect a source</Link>} />}
    </Shell>
  );
}

/** "12 min", "3 h 5 min", "2 days". */
function minutes(m?: number | null) {
  if (m == null) return "—";
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  return `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? "" : "s"}`;
}
