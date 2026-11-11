import { api } from "@/lib/api";
import { getToken } from "@/lib/session";
import { RefreshBrief } from "@/components/admin/RefreshBrief";

type Usage = {
  configured: boolean; model: string; dailyLimitPerMember: number;
  brightdata?: { configured: boolean; zone: string | null; dailyLimitPerMember: number };
  scraper?: "api.sh" | "Bright Data" | null;
  features: { feature: string; calls: number; failed: number; today: number; inputTokens: number; outputTokens: number; avgMs: number; members: number }[];
  daily: { day: string; calls: number }[];
};
type Brief = { day: string; bullets: string[]; source: "claude" | "rules"; generatedAt: string };

/** What each AI feature is called in the product. */
const NAMES: Record<string, string> = {
  assistant: "Ask Topsqill.ai", "listing.ask": "Ask about this listing", "photo.tag": "Photo tagging",
  "write.post": "Post writer", "write.comment": "Comment suggestions", "write.followup": "Lead follow-ups",
  "write.listing": "Listing descriptions", "write.profile": "Profile writer", "jobs.draft": "Job post writer",
  "project.extract": "Project import", "project.insights": "Project report", "campaign.creatives": "Ad creatives", "admin.brief": "Admin brief",
  "listing.import": "Listing import", "fetch.brightdata": "Bright Data page fetches (paid)", "fetch.apish": "api.sh page fetches (paid)",
};

export default async function AdminAi() {
  const token = await getToken();
  const [usage, brief] = await Promise.all([
    api<Usage>("/v1/admin/ai", { token }),
    api<Brief>("/v1/admin/ai/brief", { token }).catch(() => null),
  ]);
  const peak = Math.max(1, ...usage.daily.map((d) => d.calls));
  const total = usage.features.reduce((n, f) => n + f.calls, 0);
  const failed = usage.features.reduce((n, f) => n + f.failed, 0);

  return (
    <>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>AI</h1>
      <p className="muted small" style={{ marginBottom: 18 }}>Today’s brief, and how members use the AI features.</p>

      <section className="card pad" style={{ marginBottom: 16, border: "2px solid var(--vio)" }}>
        <div className="spread" style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 18 }}>✨ Daily brief</h2>
          <RefreshBrief />
        </div>
        {brief ? (
          <>
            <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>{brief.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
            <p className="small muted" style={{ margin: "10px 0 0" }}>
              {brief.source === "claude" ? "Written by AI" : "AI is off, so this is a plain summary"} · {new Date(brief.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
            </p>
          </>
        ) : <p className="muted">The brief couldn’t be prepared just now.</p>}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 16 }}>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Status</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4, color: usage.configured ? "var(--grn)" : "var(--red)" }}>
            {usage.configured ? "● On" : "● Off: no API key"}
          </div>
          <div className="small muted">Model {usage.model}</div>
        </div>
        <div className="card pad"><div className="small muted" style={{ fontWeight: 700 }}>AI calls, 7 days</div><div style={{ fontWeight: 800, fontSize: 26 }}>{total.toLocaleString("en-IN")}</div></div>
        <div className="card pad"><div className="small muted" style={{ fontWeight: 700 }}>Failed</div><div style={{ fontWeight: 800, fontSize: 26, color: failed ? "var(--red)" : undefined }}>{failed}</div></div>
        <div className="card pad">
          <div className="small muted" style={{ fontWeight: 700 }}>Protected sites (99acres, Housing…)</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4, color: usage.scraper ? "var(--grn)" : "var(--ink3)" }}>
            {usage.scraper ? `● ${usage.scraper}` : "● Off"}
          </div>
          <div className="small muted">
            {usage.scraper
              ? `${usage.features.filter((f) => f.feature.startsWith("fetch.")).reduce((n, f) => n + f.today, 0)} fetches today · ${usage.brightdata?.dailyLimitPerMember ?? 20} per member a day`
              : "Members paste the page text instead"}
          </div>
        </div>
        <div className="card pad"><div className="small muted" style={{ fontWeight: 700 }}>Limit per member</div><div style={{ fontWeight: 800, fontSize: 26 }}>{usage.dailyLimitPerMember}<span className="small muted"> / day</span></div></div>
      </div>

      {!usage.configured ? (
        <div className="card pad" style={{ marginBottom: 16, background: "var(--soft)" }}>
          AI features are running on built-in rules: search, prices and writing still work, but answers are simpler. Set <code>ANTHROPIC_API_KEY</code> on the API and worker to switch AI on.
        </div>
      ) : null}

      <section className="card pad" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Calls per day</h2>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120 }}>
          {usage.daily.map((d) => (
            <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title={`${d.day}: ${d.calls} calls`}>
              <span className="small muted">{d.calls}</span>
              <div style={{ width: "100%", maxWidth: 36, height: `${Math.max(3, (d.calls / peak) * 90)}px`, background: "var(--vio)", borderRadius: "6px 6px 2px 2px" }} />
              <span className="small muted">{d.day.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr><th>Feature</th><th>Calls (7 days)</th><th>Today</th><th>Members</th><th>Failed</th><th>Tokens in / out</th><th>Avg time</th></tr></thead>
          <tbody>
            {usage.features.length ? usage.features.map((f) => (
              <tr key={f.feature}>
                <td><b>{NAMES[f.feature] ?? f.feature}</b></td>
                <td>{f.calls.toLocaleString("en-IN")}</td>
                <td>{f.today}</td>
                <td>{f.members}</td>
                <td style={{ color: f.failed ? "var(--red)" : undefined }}>{f.failed}</td>
                <td>{f.inputTokens.toLocaleString("en-IN")} / {f.outputTokens.toLocaleString("en-IN")}</td>
                <td>{(f.avgMs / 1000).toFixed(1)} s</td>
              </tr>
            )) : <tr><td colSpan={7} className="muted">No AI calls in the last 7 days.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
