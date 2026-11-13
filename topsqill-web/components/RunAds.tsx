"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { compact, timeAgo } from "@/lib/format";

type Info = {
  status: string; enabled: boolean; platforms: { meta: boolean; google: boolean }; chosen: string[]; mediaIds: string[];
  feePct: number; minBudgetInr: number; wallet: { balancePaise: number; heldPaise: number }; holdPaise: number; chargedPaise: number;
  reviewNote?: string | null; submittedAt?: string | null; launchedAt?: string | null; endsAt?: string | null; endReason?: string | null;
  results: { spendInr: number; clicks: number; impressions: number; leads: number };
  deliveries: { platform: string; status: string; error?: string | null; stats?: Record<string, number>; spendPaise: number; budgetInr: number; syncedAt?: string | null }[];
  photos: { id: string; kind: string; thumb: string | null }[]; hasMapPin: boolean; problems: string[]; errors?: string[];
};
const PLATFORM = { meta: { name: "Facebook and Instagram", icon: "📘", note: "Lead form ads: people send their name and number without leaving the app." },
  google: { name: "Google Search", icon: "🔎", note: "Shows when people search for homes in this locality." } } as const;
const rs = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/**
 * Running the campaign's ads on Topsqill's Meta and Google accounts: choose
 * where and how much, see what's set aside from the wallet, send for review;
 * then live results with pause, resume and end.
 */
export function RunAds({ campaignId, budgetInr, days, base }: { campaignId: string; budgetInr: number; days: number; base: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [budget, setBudget] = useState(budgetInr);
  const [nDays, setDays] = useState(days);
  const [picked, setPicked] = useState<string[]>([]);
  const [agree, setAgree] = useState(false);

  function apply(i: Info) {
    setInfo(i);
    setPlatforms((p) => (p.length ? p : i.chosen.length ? i.chosen : (["meta", "google"] as const).filter((k) => i.platforms[k])));
    setPicked((p) => (p.length ? p : i.mediaIds.length ? i.mediaIds : i.photos.filter((x) => x.kind === "image").slice(0, 4).map((x) => x.id)));
  }
  useEffect(() => { clientApi<Info>(`/v1/campaigns/${campaignId}/ads`).then(apply).catch((e) => setError((e as Error).message)); }, [campaignId]);

  async function act(path: string, body?: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(path); setError("");
    try {
      const i = await clientApi<Info>(`/v1/campaigns/${campaignId}/${path}`, { method: "POST", body });
      apply(i);
      if (i.errors?.length) setError(i.errors.join(" · "));
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  if (!info) return <section className="card pad" style={{ marginBottom: 16 }}>{error ? <p className="error small">{error}</p> : <p className="muted small">Loading…</p>}</section>;

  const s = info.status;
  const holdPaise = Math.round(budget * 100 * (1 + info.feePct / 100));
  const short = Math.max(holdPaise - info.wallet.balancePaise, 0);
  const anyPlatform = info.platforms.meta || info.platforms.google;

  /* ---------------- running, paused, finished ---------------- */
  if (["active", "paused", "completed"].includes(s)) {
    const left = info.endsAt ? Math.max(Math.ceil((new Date(info.endsAt).getTime() - Date.now()) / 86_400_000), 0) : null;
    const cpl = info.results.leads ? Math.round(info.chargedPaise / info.results.leads) : null;
    return (
      <section className="card pad" style={{ marginBottom: 16, borderLeft: `4px solid ${s === "active" ? "#12B76A" : s === "paused" ? "#E08A00" : "#6A3FE0"}` }}>
        <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2 style={{ fontSize: 18 }}>{s === "active" ? "🟢 Your ads are live" : s === "paused" ? "⏸ Ads paused" : `✓ Campaign finished${info.endReason ? `: ${info.endReason.toLowerCase()}` : ""}`}</h2>
            <p className="small muted" style={{ margin: "2px 0 0" }}>
              {info.launchedAt ? `Started ${timeAgo(info.launchedAt)}` : ""}{left != null && s !== "completed" ? ` · ${left} day${left === 1 ? "" : "s"} left` : ""}
              {s !== "completed" ? ` · ${rs(Math.max(info.holdPaise - info.chargedPaise, 0))} of ${rs(info.holdPaise)} left` : ""}
            </p>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-g sm" disabled={!!busy} onClick={() => act("refresh")}>{busy === "refresh" ? "Updating…" : "↻ Update results"}</button>
            {s === "active" ? <button className="btn btn-o sm" disabled={!!busy} onClick={() => act("pause")}>{busy === "pause" ? "Pausing…" : "Pause"}</button> : null}
            {s === "paused" ? <button className="btn btn-ai sm" disabled={!!busy} onClick={() => act("resume")}>{busy === "resume" ? "Resuming…" : "Resume"}</button> : null}
            {s !== "completed" ? <button className="btn btn-g sm" disabled={!!busy} onClick={() => act("end", undefined, "End this campaign now? The ads stop, and the unspent money goes back to your wallet.")}>End</button> : null}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginTop: 12 }}>
          {[["Leads", String(info.results.leads)], ["Spent", rs(info.chargedPaise)], ["Cost per lead", cpl ? rs(cpl) : "—"], ["Clicks", compact(info.results.clicks)], ["Seen", compact(info.results.impressions)]].map(([k, v], i) => (
            <div key={k} style={{ background: i === 0 ? "var(--brand)" : "var(--soft)", color: i === 0 ? "#fff" : undefined, borderRadius: 12, padding: "10px 12px" }}>
              <div className="small" style={{ fontWeight: 700, opacity: .85 }}>{k}</div>
              <div style={{ font: '800 22px/1.1 "Bricolage Grotesque",system-ui,sans-serif', marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="col" style={{ gap: 6, marginTop: 12 }}>
          {info.deliveries.map((d) => (
            <div key={d.platform + d.status} className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
              <b>{PLATFORM[d.platform as keyof typeof PLATFORM]?.icon} {PLATFORM[d.platform as keyof typeof PLATFORM]?.name ?? d.platform}</b>
              <span className="pill" style={{ fontSize: 11 }}>{d.status === "live" ? "Running" : d.status === "paused" ? "Paused" : d.status === "failed" ? "Couldn't start" : d.status}</span>
              <span className="muted">{rs(d.spendPaise)} spent · {d.stats?.clicks ?? 0} clicks · {d.stats?.leads ?? 0} leads{d.syncedAt ? ` · updated ${timeAgo(d.syncedAt)}` : ""}</span>
              {d.error ? <span className="error">{d.error}</span> : null}
            </div>
          ))}
        </div>
        <p className="small muted" style={{ margin: "10px 0 0" }}>
          Leads from these ads arrive in <Link href="/leads">Leads</Link> straight away. Spend is charged from your wallet as it happens{info.feePct ? `, plus a ${info.feePct}% service fee` : ""}; results update every 15 minutes.
        </p>
        {error ? <p className="error small" role="alert">{error}</p> : null}
      </section>
    );
  }

  /* ---------------- waiting for review ---------------- */
  if (s === "review") {
    return (
      <section className="card pad" style={{ marginBottom: 16, borderLeft: "4px solid #2F7FE6" }}>
        <h2 style={{ fontSize: 18 }}>🕒 In review</h2>
        <p className="small" style={{ margin: "4px 0 8px" }}>
          Our team checks every campaign before it goes live, usually within a few hours. {rs(info.holdPaise)} is set aside from your wallet for it.
          You'll get a notification and an email when the ads start.
        </p>
        <p className="small muted" style={{ margin: 0 }}>Running on: {info.chosen.map((p) => PLATFORM[p as keyof typeof PLATFORM]?.name ?? p).join(" and ")}{info.submittedAt ? ` · sent ${timeAgo(info.submittedAt)}` : ""}</p>
        <button className="btn btn-g sm" style={{ marginTop: 10 }} disabled={!!busy} onClick={() => act("withdraw", undefined, "Take this campaign back? The money set aside returns to your wallet.")}>{busy ? "…" : "Take back"}</button>
        {error ? <p className="error small" role="alert">{error}</p> : null}
      </section>
    );
  }

  /* ---------------- set up and send (draft or not approved) ---------------- */
  return (
    <section className="card pad" style={{ marginBottom: 16, border: "2px solid var(--vio)" }}>
      <h2 style={{ fontSize: 18 }}>🚀 Run these ads</h2>
      <p className="small muted" style={{ margin: "2px 0 10px" }}>We run them for you on Topsqill's ad accounts. You only pay from your wallet: no ad accounts or cards needed.</p>

      {s === "rejected" && info.reviewNote ? (
        <div className="small" role="status" style={{ background: "color-mix(in srgb,#E5484D 8%,var(--card))", borderLeft: "4px solid #E5484D", padding: "8px 10px", borderRadius: 8, marginBottom: 10 }}>
          <b>Not approved:</b> {info.reviewNote} <span className="muted">Fix this and send it again.</span>
        </div>
      ) : null}
      {!info.enabled || !anyPlatform ? (
        <p className="small" style={{ background: "var(--soft)", padding: "8px 10px", borderRadius: 8 }}>Running ads isn't switched on yet. You can still use the ad text, reel and podcast below.</p>
      ) : null}
      {info.problems.filter((p) => !p.startsWith("Ads aren't")).map((p) => <p key={p} className="small error" style={{ margin: "0 0 6px" }}>⚠ {p}</p>)}

      <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend className="small" style={{ fontWeight: 800, marginBottom: 6 }}>1. Where</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 8 }}>
          {(["meta", "google"] as const).map((k) => (
            <label key={k} className="card" style={{ padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start", opacity: info.platforms[k] ? 1 : .5, cursor: info.platforms[k] ? "pointer" : "not-allowed", borderColor: platforms.includes(k) ? "var(--vio)" : undefined }}>
              <input type="checkbox" disabled={!info.platforms[k]} checked={platforms.includes(k)} onChange={(e) => setPlatforms((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))} style={{ marginTop: 3 }} />
              <span><b>{PLATFORM[k].icon} {PLATFORM[k].name}</b><br /><span className="small muted">{info.platforms[k] ? PLATFORM[k].note : "Not available yet"}</span></span>
            </label>
          ))}
        </div>
        {platforms.length === 2 ? <p className="small muted" style={{ margin: "6px 0 0" }}>The budget is split 70% Facebook and Instagram, 30% Google: Meta brings most property leads.</p> : null}
        {!info.hasMapPin ? <p className="small muted" style={{ margin: "6px 0 0" }}>Tip: <Link href={`/listings/${base}/edit`}>add a map pin to the listing</Link> so the ads reach people around the property, not the whole city.</p> : null}
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend className="small" style={{ fontWeight: 800, marginBottom: 6 }}>2. Budget and days</legend>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="small">Total ad budget (₹)<br />
            <input type="number" min={info.minBudgetInr} step={500} value={budget} onChange={(e) => setBudget(Math.max(Number(e.target.value) || 0, 0))} style={{ width: 160 }} /></label>
          <label className="small">Days<br />
            <input type="number" min={3} max={90} value={nDays} onChange={(e) => setDays(Math.min(Math.max(Number(e.target.value) || 3, 3), 90))} style={{ width: 90 }} /></label>
          <span className="small muted" style={{ alignSelf: "flex-end", paddingBottom: 8 }}>≈ {rs((budget * 100) / Math.max(nDays, 1))} a day</span>
        </div>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend className="small" style={{ fontWeight: 800, marginBottom: 6 }}>3. Photos for the ads <span className="muted" style={{ fontWeight: 400 }}>(2 or more make a swipeable carousel)</span></legend>
        {info.photos.length ? (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {info.photos.map((ph) => {
              const on = picked.includes(ph.id);
              return (
                <button key={ph.id} type="button" aria-pressed={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== ph.id) : p.length >= 6 ? p : [...p, ph.id]))}
                  style={{ position: "relative", width: 86, height: 64, borderRadius: 10, overflow: "hidden", padding: 0, border: on ? "3px solid var(--vio)" : "1.5px solid var(--line)", background: "var(--chip)", opacity: on ? 1 : .65 }}>
                  {ph.thumb ? <img src={ph.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span>{ph.kind === "video" ? "🎬" : "📷"}</span>}
                  {on ? <span style={{ position: "absolute", top: 2, right: 4, color: "#fff", fontWeight: 800, textShadow: "0 1px 3px #000" }}>{picked.indexOf(ph.id) + 1}</span> : null}
                </button>
              );
            })}
          </div>
        ) : <p className="small error">The listing has no photos: <Link href={`/listings/${base}/edit`}>add some</Link> first.</p>}
      </fieldset>

      <div style={{ background: "var(--soft)", borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
        <div className="spread small"><span>Ad budget</span><b>{rs(budget * 100)}</b></div>
        {info.feePct ? <div className="spread small"><span>Topsqill service fee ({info.feePct}%, charged only on what's spent)</span><b>{rs(budget * info.feePct)}</b></div> : null}
        <div className="spread" style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 6 }}><b>Set aside from your wallet</b><b>{rs(holdPaise)}</b></div>
        <div className="spread small muted"><span>Your wallet</span><span>{rs(info.wallet.balancePaise)} available{info.wallet.heldPaise ? ` · ${rs(info.wallet.heldPaise)} set aside for other campaigns` : ""}</span></div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>You're charged only for what the ads actually spend. Whatever isn't spent comes back to your wallet when the campaign ends, or straight away if it isn't approved.</p>
      </div>

      {short > 0 ? (
        <p className="small" style={{ margin: "0 0 10px" }}>
          You need {rs(short)} more. <Link className="btn btn-o sm" href={`/wallet?add=${Math.ceil(short / 100)}&back=/campaigns/${campaignId}`}>Add money</Link>
        </p>
      ) : null}
      <label className="row small" style={{ gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I confirm the listing's details are true, I may advertise this property, and {rs(holdPaise)} can be set aside from my wallet for these ads.</span>
      </label>
      <button className="btn btn-ai" disabled={!!busy || !agree || short > 0 || !platforms.length || !picked.length || info.problems.length > 0}
        onClick={() => act("submit", { platforms, budgetInr: budget, days: nDays, mediaIds: picked })}>
        {busy === "submit" ? "Sending…" : s === "rejected" ? "Send for review again" : "Send for review"}
      </button>
      {error ? <p className="error small" role="alert" style={{ marginTop: 8 }}>{error}</p> : null}
    </section>
  );
}
