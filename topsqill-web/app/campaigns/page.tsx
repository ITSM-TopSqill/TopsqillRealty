import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { inr, timeAgo, CAMPAIGN_COLOR as STATUS_COLOR } from "@/lib/format";
import type { Campaign } from "@/lib/types";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin?next=/campaigns");
  const { items } = await api<{ items: Campaign[] }>("/v1/campaigns", { token }).catch(() => ({ items: [] as Campaign[] }));

  return (
    <Shell user={user} current="/leads">
      <div className="spread" style={{ marginBottom: 16 }}>
        <div>
          <Link href="/leads" className="small muted">← Leads</Link>
          <h1 style={{ fontSize: 26, marginTop: 6 }}>Campaigns</h1>
          <p className="muted small">Ads for your listings, with targeting, creatives and a lead forecast built for you.</p>
        </div>
        <Link href="/campaigns/new" className="btn btn-ai">+ New campaign</Link>
      </div>
      {items.length ? (
        <div className="col">
          {items.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="card pad" style={{ textDecoration: "none" }}>
              <div className="spread">
                <b>{c.name}</b>
                <span className="pill" style={{ background: `color-mix(in srgb,${STATUS_COLOR[c.status] ?? "#8D8AA3"} 16%,transparent)`, color: STATUS_COLOR[c.status] }}>
                  {({ draft: "Draft", review: "In review", rejected: "Not approved", active: "Live", paused: "Paused", completed: "Finished" } as Record<string, string>)[c.status] ?? c.status}
                </span>
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {inr(c.budgetInr)} over {c.days} days · {c.status === "draft" ? `forecast ${c.forecast?.leads ?? 0} leads` : `${c.leadsCount} leads, ${c.qualifiedCount} qualified`} · created {timeAgo(c.createdAt)}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No campaigns yet" text="Pick one of your listings and a budget. You get the audience, ads in every format and a forecast before anything is spent."
          action={<Link href="/campaigns/new" className="btn btn-ai">Create a campaign</Link>} />
      )}
    </Shell>
  );
}
