import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { CampaignActions } from "@/components/CampaignActions";
import { inr, compact, CAMPAIGN_COLOR } from "@/lib/format";
import type { Campaign } from "@/lib/types";

export const metadata = { title: "Campaign" };
export const dynamic = "force-dynamic";

/** Channel names are plain labels ("Google Search", "Instagram and Facebook"); colour by brand. */
const COLORS: [RegExp, string][] = [
  [/instagram|facebook|meta/i, "#1877F2"], [/google/i, "#EA4335"], [/youtube/i, "#FF0000"],
  [/whatsapp/i, "#25D366"], [/linkedin/i, "#0A66C2"],
];
const ch = (c: string) => ({ label: c, color: COLORS.find(([re]) => re.test(c))?.[1] ?? "#6A3FE0" });

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user, token] = await Promise.all([params, getUser(), getToken()]);
  if (!user) redirect(`/signin?next=/campaigns/${id}`);
  const c = await api<Campaign>(`/v1/campaigns/${id}`, { token }).catch(() => null);
  if (!c) notFound();
  const p = c.plan, cr = c.creatives ?? {}, f = c.forecast;

  return (
    <Shell user={user} current="/leads">
      <Link href="/campaigns" className="small muted">← Campaigns</Link>
      <div className="spread" style={{ margin: "6px 0 16px", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24 }}>{c.name}</h1>
          <p className="muted small">{inr(c.budgetInr)} over {c.days} days · goal: {c.goal}{c.listingId ? <> · <Link href={`/listings/${c.listingId}`}>view listing</Link></> : null}</p>
        </div>
        <div className="row">
          <span className="pill" style={{ background: `color-mix(in srgb,${CAMPAIGN_COLOR[c.status]} 16%,transparent)`, color: CAMPAIGN_COLOR[c.status] }}>
            {c.status[0].toUpperCase() + c.status.slice(1)}
          </span>
          <CampaignActions id={c.id} status={c.status} />
        </div>
      </div>

      {f ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 16 }}>
          {[
            ["People reached", compact(f.reach)], ["Leads", String(c.status === "draft" ? f.leads : c.leadsCount)],
            ["Qualified", String(c.status === "draft" ? f.qualified : c.qualifiedCount)], ["Cost per lead", inr(f.costPerLead)],
            ["Cost per qualified lead", inr(f.costPerQualifiedLead)],
          ].map(([k, v], i) => (
            <div key={k} className="card pad" style={i === 1 ? { background: "var(--brand)", color: "#fff", border: 0 } : undefined}>
              <div className="small" style={{ fontWeight: 700, opacity: .85 }}>{c.status === "draft" && i < 3 ? `Forecast: ${k.toLowerCase()}` : k}</div>
              <div style={{ font: '800 26px/1.1 "Bricolage Grotesque",system-ui,sans-serif', marginTop: 6 }}>{v}</div>
            </div>
          ))}
        </div>
      ) : null}

      {c.status === "active" ? (
        <p className="card pad small" style={{ background: "color-mix(in srgb,#E08A00 12%,var(--card))", marginBottom: 16 }}>
          This campaign is marked live on Topsqill.ai. Ads only start spending once an ad account is connected and you confirm the budget there.
        </p>
      ) : null}

      {p ? (
        <div className="g2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
          <section className="card pad">
            <h2 style={{ fontSize: 17, marginBottom: 10 }}>Who will see it</h2>
            {p.personas.map((x) => (
              <div key={x.name} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                <div className="spread"><b>{x.name}</b><span className="tag">{x.share}%</span></div>
                <div className="small muted">{x.why}</div>
                <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>{x.signals.map((s) => <span key={s} className="tag">{s}</span>)}</div>
              </div>
            ))}
            <h3 style={{ fontSize: 15, margin: "14px 0 8px" }}>Pincodes · {p.radiusKm} km radius</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
              {p.pincodes.map((x) => (
                <div key={x.pin} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "8px 10px" }}>
                  <b style={{ color: "var(--vio)" }}>{x.pin}</b> <span className="small">{x.area}</span>
                  <div className="small muted">{x.reason}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="col">
            <div className="card pad">
              <h2 style={{ fontSize: 17, marginBottom: 10 }}>Where the budget goes</h2>
              {p.channels.map((x) => (
                <div key={x.channel} style={{ padding: "6px 0" }}>
                  <div className="spread small"><b>{ch(x.channel).label}</b><span>{x.budgetPct}% · {inr(Math.round(c.budgetInr * x.budgetPct / 100))}</span></div>
                  <div style={{ height: 8, borderRadius: 8, background: "var(--chip)", overflow: "hidden", marginTop: 4 }}>
                    <div style={{ width: `${x.budgetPct}%`, height: "100%", background: ch(x.channel).color }} />
                  </div>
                  <div className="small muted">{x.format}</div>
                </div>
              ))}
              <p className="small muted" style={{ margin: "8px 0 0" }}>{p.schedule}</p>
            </div>
            <div className="card pad">
              <h2 style={{ fontSize: 17, marginBottom: 8 }}>Keeping leads real</h2>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {p.qualification.questions.map((q) => <li key={q}>{q}</li>)}
                {p.qualification.otp ? <li>Phone number verified with a code</li> : null}
                {p.qualification.bot ? <li>WhatsApp bot qualifies before a call</li> : null}
                <li>Leads scoring under {p.qualification.minScore} are marked low priority</li>
              </ul>
              <h3 style={{ fontSize: 14, margin: "12px 0 6px" }}>Search keywords</h3>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{p.intentKeywords.map((k) => <span key={k} className="tag">{k}</span>)}</div>
              <div className="small muted" style={{ marginTop: 6 }}>Excluded: {p.negativeKeywords.join(", ")} · {p.exclusions.join(", ")}</div>
            </div>
          </section>
        </div>
      ) : null}

      <h2 style={{ fontSize: 20, margin: "22px 0 12px" }}>Your ads</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16, alignItems: "start" }}>
        {cr.headlines?.length ? (
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ aspectRatio: "1", background: "linear-gradient(135deg,#1F1D33,#3A2E7A 55%,#2F6FD0)", color: "#fff", padding: 16, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <b style={{ font: '800 22px/1.15 "Bricolage Grotesque",system-ui,sans-serif' }}>{cr.headlines[0]}</b>
              <span className="small" style={{ opacity: .9 }}>{cr.headlines[1]}</span>
              <span style={{ alignSelf: "flex-start", marginTop: 8, background: "#fff", color: "#1F1D33", fontWeight: 800, fontSize: 12, padding: "6px 12px", borderRadius: 999 }}>Book a site visit</span>
            </div>
            <div className="pad small">
              <b>Facebook and Instagram feed</b>
              {cr.primaryTexts?.map((t) => <p key={t} style={{ margin: "6px 0 0" }}>{t}</p>)}
              {cr.hinglish ? <p className="muted" style={{ margin: "6px 0 0" }}>Hinglish: {cr.hinglish}</p> : null}
            </div>
          </div>
        ) : null}

        {cr.googleAd ? (
          <div className="card pad small">
            <b>Google Search</b>
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginTop: 8 }}>
              <span className="small muted">Sponsored · topsqill.ai</span>
              <div style={{ color: "#1A56DB", fontWeight: 700, fontSize: 16, margin: "4px 0" }}>{cr.googleAd.headlines.slice(0, 3).join(" | ")}</div>
              <div className="muted">{cr.googleAd.descriptions[0]}</div>
            </div>
            <p className="muted" style={{ margin: "8px 0 0" }}>Also: {cr.googleAd.headlines.slice(3).join(", ")}. {cr.googleAd.descriptions.slice(1).join(" ")}</p>
          </div>
        ) : null}

        {cr.carousel?.length ? (
          <div className="card pad small">
            <b>Carousel</b>
            <div className="row" style={{ gap: 8, overflowX: "auto", marginTop: 8, paddingBottom: 4 }}>
              {cr.carousel.map((s, i) => (
                <div key={i} style={{ flex: "0 0 130px", aspectRatio: "1", borderRadius: 12, padding: 10, color: "#fff", display: "flex", flexDirection: "column", justifyContent: "flex-end",
                  background: ["#6A3FE0", "#2F7FE6", "#2E9E90", "#D9668C", "#E08A00"][i % 5] }}>
                  <b>{s.title}</b><span style={{ opacity: .9 }}>{s.sub}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {cr.reel?.length ? (
          <div className="card pad small">
            <b>Reel script, 5 scenes</b>
            <ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {cr.reel.map((s, i) => <li key={i} style={{ marginBottom: 4 }}><b>{s.caption}</b>{s.sub ? <span className="muted"> · {s.sub}</span> : null}</li>)}
            </ol>
          </div>
        ) : null}

        {cr.whatsappTemplate ? (
          <div className="card pad small">
            <b>WhatsApp follow-up</b>
            <div style={{ background: "#DCF8C6", color: "#1F1D33", borderRadius: "12px 12px 12px 2px", padding: "10px 12px", marginTop: 8, whiteSpace: "pre-wrap" }}>
              {cr.whatsappTemplate.replace("{{1}}", "Rahul")}
            </div>
          </div>
        ) : null}
      </div>

      {p?.compliance?.length ? <p className="small muted" style={{ marginTop: 16 }}>{p.compliance.join(" ")}</p> : null}
    </Shell>
  );
}
