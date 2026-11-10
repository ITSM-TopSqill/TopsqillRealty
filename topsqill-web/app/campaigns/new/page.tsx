import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { CampaignForm } from "@/components/CampaignForm";
import type { MyListing } from "@/lib/types";

export const metadata = { title: "New campaign" };
export const dynamic = "force-dynamic";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ listing?: string }> }) {
  const [{ listing }, user, token] = await Promise.all([searchParams, getUser(), getToken()]);
  if (!user) redirect("/signin?next=/campaigns/new");
  const { items } = await api<{ items: MyListing[] }>("/v1/listings/mine", { token }).catch(() => ({ items: [] as MyListing[] }));
  const live = items.filter((l) => l.status === "active");

  return (
    <Shell user={user} current="/leads">
      <Link href="/campaigns" className="small muted">← Campaigns</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>Campaign studio</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        Choose a listing and a budget. The studio uses real buyer demand on Topsqill.ai to pick who to reach,
        writes the ads for Facebook, Instagram, Google and WhatsApp, and forecasts your leads. Nothing is spent until you launch.
      </p>
      {live.length
        ? <CampaignForm listings={live} preselect={listing} />
        : <Empty title="Add a listing first" text="Campaigns promote one of your live listings."
            action={<Link href="/listings/new" className="btn btn-ai">Add a listing</Link>} />}
    </Shell>
  );
}
