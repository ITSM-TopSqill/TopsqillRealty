import Link from "next/link";
import { api } from "@/lib/api";
import { getToken } from "@/lib/session";

type Overview = {
  activeMembers: number; newThisWeek: number; pendingApprovals: number; openReports: number;
  activeListings: number; postsToday: number; mediaProcessing: number;
  signups: { day: string; count: number }[];
};

export default async function AdminOverview() {
  const token = await getToken();
  const data = await api<Overview>("/v1/admin/overview", { token });
  const peak = Math.max(1, ...data.signups.map((s) => s.count));

  const cards: [string, number, string, string][] = [
    ["Active members", data.activeMembers, "/admin/members", "var(--brand)"],
    ["New this week", data.newThisWeek, "/admin/members", "linear-gradient(115deg,#2E9E90,#2F7FE6)"],
    ["Pending approvals", data.pendingApprovals, "/admin/approvals", "linear-gradient(115deg,#E08A00,#E5484D)"],
    ["Open reports", data.openReports, "/admin/moderation", "linear-gradient(115deg,#E5484D,#8B4FEA)"],
    ["Active listings", data.activeListings, "/listings", "linear-gradient(115deg,#8B4FEA,#E5487A)"],
    ["Posts today", data.postsToday, "/", "linear-gradient(115deg,#4A86D4,#2E9E90)"],
  ];

  return (
    <>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Overview</h1>
      <p className="muted small" style={{ marginBottom: 18 }}>How Topsqill.ai is doing right now.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 20 }}>
        {cards.map(([label, value, href, bg]) => (
          <Link key={label} href={href} className="card pad" style={{ background: bg, color: "#fff", border: 0, textDecoration: "none" }}>
            <div className="small" style={{ fontWeight: 700, opacity: .92 }}>{label}</div>
            <div style={{ font: '800 30px/1 "Bricolage Grotesque", system-ui, sans-serif', marginTop: 6 }}>
              {value.toLocaleString("en-IN")}
            </div>
          </Link>
        ))}
      </div>

      <div className="card pad">
        <h2 style={{ fontSize: 18, marginBottom: 14 }}>Signups, last 14 days</h2>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150 }}>
          {data.signups.map((s) => (
            <div key={s.day} style={{ flex: 1, textAlign: "center" }} title={`${s.day}: ${s.count}`}>
              <div style={{ height: `${(s.count / peak) * 120}px`, background: "var(--brand)", borderRadius: "6px 6px 0 0", minHeight: 3 }} />
              <div className="small muted" style={{ fontSize: 10, marginTop: 4 }}>{s.day.slice(8)}</div>
            </div>
          ))}
        </div>
      </div>

      {data.mediaProcessing ? (
        <p className="small muted" style={{ marginTop: 14 }}>{data.mediaProcessing} media files are still being processed.</p>
      ) : null}
    </>
  );
}
