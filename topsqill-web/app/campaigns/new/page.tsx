import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { NewCampaignTabs } from "@/components/NewCampaignTabs";
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
        Promote a live listing, or run ads from a photo or video with no listing at all. The studio writes the ads
        for Facebook, Instagram, Google and WhatsApp. Nothing is spent until you launch.
      </p>
      <NewCampaignTabs listings={live} preselect={listing} />
    </Shell>
  );
}
