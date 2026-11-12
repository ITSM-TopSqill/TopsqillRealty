import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { CampaignActions } from "@/components/CampaignActions";
import { AdStudio } from "@/components/AdStudio";
import { ReelPlayer } from "@/components/ReelPlayer";
import { CampaignPodcast } from "@/components/CampaignPodcast";
import { inr, compact, CAMPAIGN_COLOR, imageUrl } from "@/lib/format";
import type { Campaign, Listing } from "@/lib/types";

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
  const listing = c.listingId ? await api<Listing>(`/v1/listings/${c.listingId}`, { token }).catch(() => null) : null;
  const photos = (listing?.media ?? []).filter((m) => m.kind === "image").map((m) => imageUrl(m, "large")).filter(Boolean) as string[];
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://topsqill.ai";
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
      {cr.headlines?.length ? (
        <AdStudio campaignId={c.id} creatives={cr} photo={photos[0] ?? null} advertiser={user.name} link={c.listingId ? `${site}/listings/${c.listingId}` : site} />
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16, alignItems: "start" }}>
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

        {cr.reel?.length ? <ReelPlayer scenes={cr.reel} photos={photos} price={listing ? inr(listing.priceInr, listing.purpose === "rent") : ""} title={c.name} /> : null}
        <CampaignPodcast campaignId={c.id} initial={(cr as { podcast?: never }).podcast ?? null} />

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
