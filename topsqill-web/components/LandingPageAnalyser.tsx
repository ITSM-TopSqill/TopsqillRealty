"use client";

import { useEffect, useState } from "react";
import { clientApi } from "@/lib/api";
import type { LandingPageAnalysis } from "@/lib/types";

const CONFIDENCE_COLOR: Record<string, string> = { high: "#12B76A", medium: "#B9850A", low: "#8D8AA3" };

/**
 * Landing Page Intelligence (Module 4): fetch a competitor's real landing
 * page and get a structured breakdown of its messaging, offers, CTAs and
 * trust signals - or paste the page text by hand for pages that block
 * automated readers. Same approve-nothing, invent-nothing discipline as
 * the ad-creative analyser: a failed read or AI-off means nothing is
 * saved, never a guessed placeholder.
 */
export function LandingPageAnalyser({ competitorId, competitorName }: { competitorId?: string; competitorName?: string } = {}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<LandingPageAnalysis | null>(null);
  const [history, setHistory] = useState<LandingPageAnalysis[]>([]);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [manualText, setManualText] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState("");

  useEffect(() => { refreshHistory(); }, [competitorId]);

  function refreshHistory() {
    const qs = competitorId ? `?competitorId=${encodeURIComponent(competitorId)}` : "";
    clientApi<{ items: LandingPageAnalysis[] }>(`/v1/competitive-intelligence/landing-pages${qs}`).then((r) => setHistory(r.items)).catch(() => {});
  }

  async function analyse() {
    if (!url.trim()) return;
    setBusy(true); setError(""); setAnalysis(null);
    try {
      const row = await clientApi<LandingPageAnalysis>("/v1/competitive-intelligence/landing-pages", { method: "POST", body: { url: url.trim(), competitorId } });
      setAnalysis(row);
      refreshHistory();
    } catch (e) { setError((e as Error).message || "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function analyseManual() {
    if (manualText.trim().length < 200) { setManualError("Paste at least 200 characters of real page text - too little to analyse honestly."); return; }
    setManualBusy(true); setManualError("");
    try {
      const row = await clientApi<LandingPageAnalysis>("/v1/competitive-intelligence/landing-pages/manual", {
        method: "POST", body: { text: manualText, url: manualUrl.trim() || undefined, competitorId },
      });
      setAnalysis(row);
      setManualText(""); setManualUrl("");
      refreshHistory();
    } catch (e) { setManualError((e as Error).message || "Something went wrong."); }
    finally { setManualBusy(false); }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card pad">
        <b>Landing Page Intelligence</b>
        <p className="small muted" style={{ marginTop: 2 }}>
          {competitorName ? <>Fetch <b>{competitorName}</b>&apos;s real landing page</> : "Fetch a competitor's real landing page"} for a structured read of its
          messaging, offers, CTAs and trust signals - never a traffic or conversion claim, since that data isn&apos;t on the page.
        </p>
        <div className="field">
          <label htmlFor="lp-url">Landing page URL</label>
          <input id="lp-url" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && analyse()} placeholder="https://competitor.com/landing" />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ai" disabled={busy || !url.trim()} onClick={analyse}>{busy ? "Fetching…" : "🔍 Fetch & analyse"}</button>
          <button type="button" className="btn btn-g" onClick={() => setManualOpen((v) => !v)}>{manualOpen ? "Hide" : "Paste page text instead"}</button>
        </div>
        {error ? <p className="error small" style={{ marginTop: 8 }}>{error}</p> : null}
      </div>

      {manualOpen ? (
        <div className="card pad">
          <b>Paste page text</b>
          <p className="small muted" style={{ marginTop: 2 }}>For pages that block automated readers - paste the visible text of the landing page and run the same breakdown on it.</p>
          <div className="field">
            <label htmlFor="lp-manual-url">Page URL (optional, for reference)</label>
            <input id="lp-manual-url" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://competitor.com/landing" />
          </div>
          <div className="field">
            <label htmlFor="lp-manual-text">Page text</label>
            <textarea id="lp-manual-text" style={{ width: "100%", minHeight: 140 }} value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="Paste the landing page's visible text here…" />
          </div>
          <button type="button" className="btn btn-ai" disabled={manualBusy} onClick={analyseManual}>{manualBusy ? "Analysing…" : "🔍 Analyse this text"}</button>
          {manualError ? <p className="error small" style={{ marginTop: 8 }}>{manualError}</p> : null}
        </div>
      ) : null}

      {analysis ? <LandingPageCard a={analysis} /> : null}

      {history.length ? (
        <div className="card pad">
          <b className="small">Past analyses{competitorName ? ` for ${competitorName}` : ""}</b>
          <div className="col" style={{ gap: 10, marginTop: 8 }}>
            {history.filter((h) => h.id !== analysis?.id).map((h) => <LandingPageCard key={h.id} a={h} collapsed />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LandingPageCard({ a, collapsed }: { a: LandingPageAnalysis; collapsed?: boolean }) {
  return (
    <div className={collapsed ? "" : "card pad"} style={collapsed ? { borderTop: "1px solid var(--line)", paddingTop: 10 } : { borderLeft: "4px solid #6A3FE0" }}>
      <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
        <b className="small">{a.headline}</b>
        <div className="row" style={{ gap: 4 }}>
          <span className="pill small" style={{ background: "color-mix(in srgb,#8D8AA3 14%,transparent)" }}>
            {a.inputSource === "manual" ? "entered by hand" : "fetched live"}
          </span>
          <span className="pill small" style={{ background: `color-mix(in srgb,${CONFIDENCE_COLOR[a.confidence]} 16%,transparent)`, color: CONFIDENCE_COLOR[a.confidence] }}>
            {a.confidence} confidence
          </span>
        </div>
      </div>
      {a.subheadline ? <p className="small muted" style={{ marginTop: 4 }}>{a.subheadline}</p> : null}
      <div className="col" style={{ gap: 4, marginTop: 8 }}>
        {a.keyMessages.length ? <p className="small"><b>Key messages</b> — {a.keyMessages.join(" · ")}</p> : null}
        {a.offers.length ? <p className="small"><b>Offers</b> — {a.offers.join(" · ")}</p> : null}
        {a.ctas.length ? <p className="small"><b>CTAs</b> — {a.ctas.join(" · ")}</p> : null}
        {a.trustSignals.length ? <p className="small"><b>Trust signals</b> — {a.trustSignals.join(" · ")}</p> : null}
        {a.pricingMentioned ? <p className="small muted"><b>Pricing</b> — {a.pricingMentioned}</p> : null}
        {a.formFields.length ? <p className="small muted"><b>Form asks for</b> — {a.formFields.join(", ")}</p> : null}
      </div>
      {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="small" style={{ marginTop: 6, display: "inline-block" }}>View page →</a> : null}
      <p className="small muted" style={{ marginTop: 6 }}>{new Date(a.createdAt).toLocaleString("en-IN")} · AI-read from the page&apos;s own text, not a performance claim</p>
    </div>
  );
}
