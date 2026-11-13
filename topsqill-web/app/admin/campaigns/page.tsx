import Link from "next/link";
import { api } from "@/lib/api";
import { getToken } from "@/lib/session";
import { Empty } from "@/components/ui";
import { CampaignReviewCard, type AdminCampaign } from "@/components/admin/CampaignReviewCard";

export const metadata = { title: "Campaign reviews" };

const TABS = [["review", "Waiting"], ["active", "Live"], ["paused", "Paused"], ["completed", "Finished"], ["rejected", "Not approved"]] as const;

/** Ad campaigns members want to run on Topsqill's ad accounts: check, approve (goes live) or reject (money goes back). */
export default async function CampaignReviews({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ status }, token] = await Promise.all([searchParams, getToken()]);
  const tab = TABS.some(([k]) => k === status) ? status! : "review";
  const q = await api<{ counts: Record<string, number>; items: AdminCampaign[] }>(`/v1/admin/campaigns?status=${tab}`, { token }).catch(() => ({ counts: {} as Record<string, number>, items: [] as AdminCampaign[] }));
  return (
    <>
      <div className="spread" style={{ flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 26, marginBottom: 4 }}>Campaign reviews</h1>
          <p className="muted small" style={{ margin: 0 }}>These ads run on Topsqill's own Meta and Google accounts, so check the text, photos and listing first. Approving creates the ads right away.</p>
        </div>
        <Link href="/admin/ads" className="btn btn-g sm">⚙ Ads settings</Link>
      </div>
      <nav className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }} aria-label="Campaign status">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/admin/campaigns${k === "review" ? "" : `?status=${k}`}`} className={`chip${tab === k ? " on" : ""}`} aria-current={tab === k ? "page" : undefined}>
            {label}{q.counts?.[k] ? ` · ${q.counts[k]}` : ""}
          </Link>
        ))}
      </nav>
      {q.items.length ? <div className="col" style={{ gap: 14 }}>{q.items.map((c) => <CampaignReviewCard key={c.id} c={c} />)}</div>
        : <Empty title={tab === "review" ? "Nothing waiting" : "Nothing here"} text={tab === "review" ? "Campaigns members send for review appear here." : ""} />}
    </>
  );
}
