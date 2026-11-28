import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { CompetitiveIntelligenceWorkspace } from "@/components/CompetitiveIntelligenceWorkspace";

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
        Track competitors by hand or from AI suggestions grounded in your business profile, then search Meta&apos;s public Ad Library (India) -
        the one source here with a genuine public API. Google Ads Transparency Center, TikTok Creative Center and LinkedIn&apos;s ad library
        aren&apos;t covered - no public API for them, and this build doesn&apos;t scrape.
        Shows real ad text, how long each has run, and an AI creative-strategy breakdown - never a competitor&apos;s CTR, ROAS, spend or sales, since that data isn&apos;t available from this source.
      </p>
      <CompetitiveIntelligenceWorkspace />
      <p style={{ marginTop: 16 }}>
        <Link href="/market-strategy">Find market-gap opportunities &amp; strategies →</Link>
        {" · "}
        <Link href="/competitive-dashboard">See everything on the dashboard →</Link>
      </p>
    </Shell>
  );
}
