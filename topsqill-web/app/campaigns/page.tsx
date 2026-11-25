import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { CampaignCard } from "@/components/CampaignCard";
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
        <div className="row" style={{ gap: 8 }}>
          <Link href="/campaigns/insights" className="btn btn-o">✨ Insights</Link>
          <Link href="/campaigns/new" className="btn btn-ai">+ New campaign</Link>
        </div>
      </div>
      {items.length ? (
        <div className="col">
          {items.map((c) => <CampaignCard key={c.id} c={c} />)}
        </div>
      ) : (
        <Empty title="No campaigns yet" text="Pick one of your listings and a budget. You get the audience, ads in every format and a forecast before anything is spent."
          action={<Link href="/campaigns/new" className="btn btn-ai">Create a campaign</Link>} />
      )}
    </Shell>
  );
}
