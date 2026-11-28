import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { CompetitiveDashboardView } from "@/components/CompetitiveDashboard";

export const metadata = { title: "Competitive Dashboard" };
export const dynamic = "force-dynamic";

export default async function CompetitiveDashboardPage() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/competitive-dashboard");

  return (
    <Shell user={user} current="/leads">
      <Link href="/market-strategy" className="small muted">← Market Strategy</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>Competitive Dashboard</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        One view across everything built here - competitors, ad &amp; creative research, market-gap opportunities, differentiation strategies,
        creative concepts, draft campaigns and audience strategy. Every number is read straight from the page that owns it - nothing here is
        recalculated or invented.
      </p>
      <CompetitiveDashboardView />
    </Shell>
  );
}
