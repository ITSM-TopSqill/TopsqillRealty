"use client";

import { useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";

export type ImportConfig = { bhk: number; areaSqft: number; priceInr: number; label: string; startingPrice?: boolean };
export type ImportDraft = {
  source: "claude" | "rules"; sourceUrl: string; site: string;
  title: string; purpose: "sale" | "rent"; kind: string; bhk: number | null; areaSqft: number | null;
  priceInr: number | null; priceOnRequest: boolean;
  city: string; locality: string; possession: string; furnishing: string; facing: string;
  description: string; amenities: string[]; usps: string[]; reraNumber: string;
  projectName: string; builder: string;
  lat: number | null; lng: number | null; locationExact: boolean;
  videoUrl: string; tourUrl: string;
  configs: ImportConfig[]; images: { url: string; alt: string }[]; notes: string[];
  /** What the source page had; never copied. */
  foundMedia?: { photos: number; video: boolean; tour: boolean };
};

/**
 * "Import from a link": paste another listing or a builder's project page,
 * and the form below is filled in from it. Nothing is published until the
 * member checks the form and presses Publish. Photos are only copied when
 * the member picks them and confirms they may use them.
 */
export function ImportFromLink({ onDraft, onConfig }: {
  onDraft: (d: ImportDraft) => void;
  onConfig: (c: ImportConfig, d: ImportDraft) => void;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState<"read" | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [config, setConfig] = useState(0);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!/^https?:\/\/\S+\.\S+/i.test(url.trim())) { setError("Paste the full link, starting with https://"); return; }
    setBusy("read"); setError("");
    try {
      const d = await clientApi<ImportDraft>("/v1/ai/listings/import", { method: "POST", body: { url: url.trim(), text: text.trim() || undefined } });
      setDraft(d); setConfig(0);
      onDraft(d);
    } catch (err) {
      setError((err as Error).message);
      setShowText(true);
    } finally { setBusy(null); }
  }

  function choose(i: number) {
    if (!draft) return;
    setConfig(i);
    onConfig(draft.configs[i], draft);
  }





  return (
    <div className="card pad" style={{ border: "2px solid var(--vio)" }}>
      <h2 style={{ fontSize: 17, marginBottom: 4 }}>🔗 Import from a link</h2>
      <p className="small muted" style={{ marginBottom: 10 }}>
        Paste the property’s page on a builder’s site or another portal. We read it and fill in the form below; you check everything before publishing.
      </p>
      <form className="row" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={run}>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://builder.com/projects/sky-gardens" aria-label="Link to import"
          style={{ flex: "1 1 260px", height: 42, border: "1.5px solid var(--line)", borderRadius: 12, padding: "0 12px", background: "var(--card)" }} />
        <button className="btn btn-ai" disabled={busy !== null}>{busy === "read" ? "Reading the page…" : draft ? "Import again" : "Import"}</button>
      </form>
      {showText ? (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="pagetext">Page text (optional)</label>
          <textarea id="pagetext" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={60000}
            placeholder="If the site won’t open for us: open it in your browser, select all (Ctrl+A), copy, and paste here." />
        </div>
      ) : (
        <button type="button" className="linklike small" style={{ marginTop: 6 }} onClick={() => setShowText(true)}>Site won’t open? Paste its text instead</button>
      )}
      {busy === "read" ? <p className="small muted" style={{ marginTop: 8 }}>This takes 10 to 30 seconds: reading the page, the photos and the map.</p> : null}
      {error ? <p className="error" style={{ marginTop: 10 }}>{error}</p> : null}

      {draft ? (
        <div className="col" style={{ gap: 14, marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <p className="small" style={{ margin: 0 }}>
            ✓ Filled in from <b>{draft.site}</b>{draft.projectName ? <> · {draft.projectName}</> : null}
            <span className="muted"> · {draft.source === "claude" ? "read by AI" : "basic reading (AI is off, so check the details closely)"}</span>
          </p>

          {draft.configs.length > 1 ? (
            <div>
              <b className="small">This page lists {draft.configs.length} home types. Which one is this listing?</b>
              <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {draft.configs.map((c, i) => (
                  <button key={i} type="button" className={`chip ${i === config ? "on" : ""}`} onClick={() => choose(i)} aria-pressed={i === config}>
                    {c.label}{c.priceInr ? ` · ${inr(c.priceInr)}${c.startingPrice ? " onwards" : ""}` : ""}
                  </button>
                ))}
              </div>
              <p className="small muted" style={{ marginTop: 6 }}>
                Selling all of them? <Link href={`/projects/new?url=${encodeURIComponent(draft.sourceUrl)}`}>Build a project page instead</Link>; it creates one listing per home type.
              </p>
            </div>
          ) : null}

          <div style={{ background: "var(--soft)", borderRadius: 12, padding: "10px 14px" }}>
            <b className="small">📷 Photos and videos: add your own</b>
            <p className="small" style={{ margin: "4px 0 0" }}>
              {draft.foundMedia && (draft.foundMedia.photos || draft.foundMedia.video)
                ? `The page has ${[draft.foundMedia.photos ? `${draft.foundMedia.photos} photo${draft.foundMedia.photos === 1 ? "" : "s"}` : "", draft.foundMedia.video ? "a video" : ""].filter(Boolean).join(" and ")}, but they belong to that site, so they aren’t copied. `
                : ""}
              Add your own below: send them to Topsqill on WhatsApp, pick them from your Instagram, or upload from your device.
            </p>
          </div>

          <p className="small muted" style={{ margin: 0 }}>
            {draft.lat != null ? (draft.locationExact ? "📍 Map location taken from the page. " : "📍 Map set to the locality’s centre (the page had no pin). ") : "No map location found. "}
          </p>

          {draft.notes.length ? (
            <div style={{ background: "var(--soft)", borderRadius: 12, padding: "10px 14px" }}>
              <b className="small">Check before publishing</b>
              <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {draft.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : `₹${Math.round(n / 1e5)} L`);

