import Link from "next/link";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
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
    api<{ last7Days: number; qualified: number; booked: number; averageScore: number; total: number; bySource: { source: string; n: number }[] }>(
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
          <Link href="/campaigns/new" className="btn btn-ai">Create campaign</Link>
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
        </div>
      ) : null}

      {board.total
        ? <LeadBoard columns={board.columns} />
        : <Empty title="No leads yet" text="Connect a lead source, or run a campaign, and new enquiries will appear here automatically."
            action={<Link href="/leads/sources" className="btn btn-ai">Connect a source</Link>} />}
    </Shell>
  );
}
