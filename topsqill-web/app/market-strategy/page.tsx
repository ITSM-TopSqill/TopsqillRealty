import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { MarketStrategyWorkspace } from "@/components/MarketStrategyWorkspace";

export const metadata = { title: "Market Gap & Strategy" };
export const dynamic = "force-dynamic";

export default async function MarketStrategyPage() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/market-strategy");

  return (
    <Shell user={user} current="/leads">
      <Link href="/competitive-intelligence" className="small muted">← Competitive Intelligence</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>Market Gap &amp; Strategy</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        Compares your business profile against your tracked competitors and their saved creative analyses to find real, evidence-backed
        growth opportunities, then generates differentiation strategies from a fixed set of starting templates. Every opportunity and
        strategy is reviewed and approved one at a time - nothing here launches a campaign on its own.
      </p>
      <MarketStrategyWorkspace />
      <p style={{ marginTop: 16 }}><Link href="/competitive-dashboard">See everything together on the dashboard →</Link></p>
    </Shell>
  );
}
