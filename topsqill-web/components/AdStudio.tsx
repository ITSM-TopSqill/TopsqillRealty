"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";

type Cr = { headlines?: string[]; primaryTexts?: string[]; cta?: string | null; googleAd?: { headlines: string[]; descriptions: string[] } };
const CTAS = ["Book a site visit", "Get the price sheet", "Learn more", "Call now", "WhatsApp us"];

/**
 * Edit the ad text and see it as people will: an Instagram / Facebook feed
 * ad and a Google search ad, updating as you type, with the platforms'
 * length limits counted. Saving keeps the edits on the campaign.
 */
export function AdStudio({ campaignId, creatives, photo, advertiser, link }: { campaignId: string; creatives: Cr; photo?: string | null; advertiser: string; link: string }) {
  const [h1, setH1] = useState(creatives.headlines?.[0] ?? "");
  const [h2, setH2] = useState(creatives.headlines?.[1] ?? "");
  const [text, setText] = useState(creatives.primaryTexts?.[0] ?? "");
  const [cta, setCta] = useState(creatives.cta ?? CTAS[0]);
  const [gh, setGh] = useState<string[]>([0, 1, 2].map((i) => creatives.googleAd?.headlines?.[i] ?? ""));
  const [gd, setGd] = useState(creatives.googleAd?.descriptions?.[0] ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const dirty = () => state !== "idle" && setState("idle");

  async function save() {
    setState("saving"); setError("");
    try {
      await clientApi(`/v1/campaigns/${campaignId}/creatives`, { method: "PATCH", body: {
        headlines: [h1, h2, ...(creatives.headlines?.slice(2) ?? [])].filter(Boolean),
        primaryTexts: [text, ...(creatives.primaryTexts?.slice(1) ?? [])].filter(Boolean),
        cta, googleHeadlines: [...gh, ...(creatives.googleAd?.headlines?.slice(3) ?? [])].filter(Boolean),
        googleDescriptions: [gd, ...(creatives.googleAd?.descriptions?.slice(1) ?? [])].filter(Boolean),
      } });
      setState("saved");
    } catch (e) { setError((e as Error).message); setState("error"); }
  }

  const count = (v: string, max: number) => <span className="small" style={{ color: v.length > max ? "var(--red, #d33)" : "var(--ink3)" }}>{v.length}/{max}</span>;
  const field = (id: string, label: string, v: string, set: (s: string) => void, max: number, rows = 1) => (
    <div key={id} className="field" style={{ marginTop: 8 }}>
      <label htmlFor={id} className="spread"><span>{label}</span>{count(v, max)}</label>
      {rows > 1
        ? <textarea id={id} rows={rows} value={v} maxLength={max + 40} onChange={(e) => { set(e.target.value); dirty(); }} />
        : <input id={id} value={v} maxLength={max + 20} onChange={(e) => { set(e.target.value); dirty(); }} />}
    </div>
  );
  const host = link.replace(/^https?:\/\//, "").split("/")[0];

  return (
    <section className="card pad" style={{ marginBottom: 16 }}>
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>✏️ Ad studio · live preview</h2>
        <div className="row" style={{ gap: 8 }}>
          {state === "saved" ? <span className="small" style={{ color: "var(--vio)", fontWeight: 700 }}>✓ Saved</span> : null}
          <button type="button" className="btn btn-p sm" onClick={save} disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
      {error ? <p className="small error">{error}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18, marginTop: 10, alignItems: "start" }}>
        <div>
          <b className="small">Instagram and Facebook</b>
          {field("ad-h1", "Headline", h1, setH1, 40)}
          {field("ad-h2", "Second line", h2, setH2, 40)}
          {field("ad-text", "Primary text", text, setText, 280, 4)}
          <div className="field" style={{ marginTop: 8 }}><label htmlFor="ad-cta">Button</label>
            <select id="ad-cta" value={cta} onChange={(e) => { setCta(e.target.value); dirty(); }}>{CTAS.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <b className="small" style={{ display: "block", marginTop: 14 }}>Google search</b>
          {gh.map((g, i) => field(`ad-gh${i}`, `Headline ${i + 1}`, g, (v) => setGh((xs) => xs.map((x, j) => (j === i ? v : x))), 30))}
          {field("ad-gd", "Description", gd, setGd, 90, 2)}
        </div>

        <div className="col" style={{ gap: 14 }}>
          {/* Feed ad, as on Instagram / Facebook */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--card)", maxWidth: 380 }} aria-label="Instagram and Facebook preview">
            <div className="row" style={{ gap: 8, padding: "10px 12px" }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#7B3DFF,#E5487A)", color: "#fff", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 800 }}>{advertiser[0]}</span>
              <div style={{ lineHeight: 1.1 }}><b className="small">{advertiser}</b><div className="small muted" style={{ fontSize: 11 }}>Sponsored</div></div>
            </div>
            <div style={{ aspectRatio: "1", position: "relative", background: photo ? `center/cover no-repeat url(${photo})` : "linear-gradient(135deg,#1F1D33,#3A2E7A 55%,#2F6FD0)" }}>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "40px 14px 12px", background: "linear-gradient(transparent, rgba(0,0,0,.72))", color: "#fff" }}>
                <b style={{ font: '800 20px/1.15 "Bricolage Grotesque",system-ui,sans-serif', display: "block" }}>{h1 || "Your headline"}</b>
                <span className="small" style={{ opacity: .92 }}>{h2}</span>
              </div>
            </div>
            <div className="spread" style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", gap: 8 }}>
              <span className="small" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span className="muted" style={{ fontSize: 11 }}>{host.toUpperCase()}</span><br /><b>{h1 || "Your headline"}</b></span>
              <span style={{ background: "#0866FF", color: "#fff", fontWeight: 700, fontSize: 13, padding: "7px 12px", borderRadius: 8, whiteSpace: "nowrap" }}>{cta}</span>
            </div>
            <p className="small" style={{ margin: 0, padding: "10px 12px", whiteSpace: "pre-wrap" }}><b>{advertiser}</b> {text || "Your primary text appears here."}</p>
          </div>

          {/* Google search ad */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 14, background: "var(--card)", maxWidth: 520 }} aria-label="Google search preview">
            <div className="small" style={{ fontWeight: 700 }}>Sponsored</div>
            <div className="small muted">{host}</div>
            <div style={{ color: "#1A0DAB", fontSize: 18, margin: "2px 0", lineHeight: 1.3 }}>{gh.filter(Boolean).join(" | ") || "Your Google headlines"}</div>
            <div className="small" style={{ color: "#4D5156" }}>{gd || "Your description appears here."}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
