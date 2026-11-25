"use client";

import { useEffect, useState } from "react";
import { clientApi } from "@/lib/api";
import type { AdLibraryResult, PatternSummary } from "@/lib/types";

type Watch = { id: string; searchTerms: string; lastCheckedAt: string | null };

/**
 * Competitive Intelligence: a real, on-demand search of Meta's public Ad
 * Library. No fabricated performance numbers - only what the source
 * actually provides (headline/body text, platforms, first/last seen,
 * still-running status) plus an optional, clearly-labelled AI pattern
 * summary. Google/TikTok/LinkedIn aren't covered - no public API for them.
 *
 * Continuous Market Learning: a search can be saved as a "watch" - the
 * background worker re-checks it every few hours and notifies of
 * genuinely new ads only (never on the first check, which just baselines).
 */
export function CompetitorSearch() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<AdLibraryResult[] | null>(null);
  const [patterns, setPatterns] = useState<PatternSummary | null>(null);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [watching, setWatching] = useState(false);

  useEffect(() => { refreshWatches(); }, []);

  async function refreshWatches() {
    clientApi<{ items: Watch[] }>("/v1/competitive-intelligence/watches").then((r) => setWatches(r.items)).catch(() => {});
  }

  async function search() {
    if (!q.trim()) return;
    setBusy(true); setError(""); setResults(null); setPatterns(null);
    try {
      const r = await clientApi<{ results: AdLibraryResult[]; patterns: PatternSummary }>(`/v1/competitive-intelligence/ads?q=${encodeURIComponent(q)}&limit=20`);
      setResults(r.results);
      setPatterns(r.patterns);
    } catch (e) { setError((e as Error).message || "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function watch() {
    if (!q.trim()) return;
    setWatching(true); setError("");
    try {
      await clientApi("/v1/competitive-intelligence/watches", { method: "POST", body: { searchTerms: q } });
      await refreshWatches();
    } catch (e) { setError((e as Error).message || "Something went wrong."); }
    finally { setWatching(false); }
  }

  async function removeWatch(id: string) {
    try { await clientApi(`/v1/competitive-intelligence/watches/${id}`, { method: "DELETE" }); await refreshWatches(); }
    catch (e) { setError((e as Error).message || "Something went wrong."); }
  }

  const alreadyWatching = watches.some((w) => w.searchTerms.toLowerCase() === q.trim().toLowerCase());

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card pad">
        <div className="field">
          <label htmlFor="comp-search">Advertiser, product or keyword</label>
          <input id="comp-search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="e.g. 3 BHK Gurgaon, or a builder's name" />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ai" disabled={busy || !q.trim()} onClick={search}>{busy ? "Searching…" : "Search Meta Ad Library"}</button>
          <button type="button" className="btn btn-o" disabled={watching || !q.trim() || alreadyWatching} onClick={watch} title="Re-checked every few hours; you're notified only of genuinely new ads">
            {alreadyWatching ? "Already watching" : watching ? "Saving…" : "👁 Watch this search"}
          </button>
        </div>
        {error ? <p className="error small" style={{ marginTop: 8 }}>{error}</p> : null}
      </div>

      {watches.length ? (
        <div className="card pad">
          <b>Watched searches</b>
          <p className="small muted" style={{ marginTop: 2 }}>Re-checked every few hours. You&apos;ll get a notification only when a genuinely new ad shows up - never on the first check.</p>
          <div className="col" style={{ gap: 6, marginTop: 8 }}>
            {watches.map((w) => (
              <div key={w.id} className="spread" style={{ gap: 8 }}>
                <span className="small">{w.searchTerms}{w.lastCheckedAt ? <span className="muted"> · last checked {new Date(w.lastCheckedAt).toLocaleString("en-IN")}</span> : <span className="muted"> · not checked yet</span>}</span>
                <button type="button" className="linklike small" onClick={() => removeWatch(w.id)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {results ? (
        results.length ? (
          <>
            {patterns ? (
              <div className="card pad" style={{ borderLeft: "4px solid #6A3FE0" }}>
                <b>💡 Patterns observed</b>
                <p className="small muted" style={{ marginTop: 2 }}>Not proof any of these perform well - a long-running or repeated ad is a signal to consider testing, not evidence of success.</p>
                <p className="small" style={{ marginTop: 6 }}>{patterns.available ? patterns.text : patterns.reason}</p>
              </div>
            ) : null}
            <div className="col" style={{ gap: 10 }}>
              {results.map((r, i) => (
                <div key={i} className="card pad">
                  <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
                    <b>{r.pageName}</b>
                    <span className="pill" style={{ background: r.stillRunning ? "color-mix(in srgb,#12B76A 16%,transparent)" : "color-mix(in srgb,#8D8AA3 16%,transparent)", color: r.stillRunning ? "#12B76A" : "#8D8AA3" }}>
                      {r.stillRunning ? "Still running" : "Stopped"}{r.daysObserved ? ` · observed ${r.daysObserved}d` : ""}
                    </span>
                  </div>
                  {r.headline ? <p className="small" style={{ marginTop: 6, fontWeight: 700 }}>{r.headline}</p> : null}
                  {r.body ? <p className="small muted" style={{ marginTop: 2 }}>{r.body}</p> : null}
                  {r.platforms.length ? <p className="small muted" style={{ marginTop: 4 }}>{r.platforms.join(", ")}</p> : null}
                  {r.snapshotUrl ? <a href={r.snapshotUrl} target="_blank" rel="noreferrer" className="small" style={{ marginTop: 4, display: "inline-block" }}>View in Ad Library →</a> : null}
                </div>
              ))}
            </div>
          </>
        ) : <p className="small muted">No currently or recently running ads found for that search.</p>
      ) : null}
    </div>
  );
}
