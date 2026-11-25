import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { CompetitorSearch } from "@/components/CompetitorSearch";

export const metadata = { title: "Competitive Intelligence" };
export const dynamic = "force-dynamic";

export default async function CompetitiveIntelligencePage() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/competitive-intelligence");

  return (
    <Shell user={user} current="/leads">
      <Link href="/campaigns" className="small muted">← Campaigns</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>Competitive Intelligence</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        Real, on-demand search of Meta&apos;s public Ad Library (India) - the one source here with a genuine public API.
        Google Ads Transparency Center, TikTok Creative Center and LinkedIn&apos;s ad library aren&apos;t covered - no public API for them, and this build doesn&apos;t scrape.
        Shows real ad text and how long each has run - never a competitor&apos;s CTR, ROAS, spend or sales, since that data isn&apos;t available from this source.
      </p>
      <CompetitorSearch />
    </Shell>
  );
}
