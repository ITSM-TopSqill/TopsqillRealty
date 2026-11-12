"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";

type Line = { host: "Priya" | "Arjun"; line: string };
type Podcast = { script: Line[]; audioUrl: string | null; seconds: number; source: string; at: string };

/**
 * A 60 to 90 second audio ad: two hosts, Priya and Arjun, chat about the home
 * in Indian English. Made on the server with Indian English voices (MP3 to
 * play and download); where that isn't available the browser reads it aloud.
 */
export function CampaignPodcast({ campaignId, initial }: { campaignId: string; initial?: Podcast | null }) {
  const [p, setP] = useState<Podcast | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);

  async function make(regenerate: boolean) {
    setBusy(true); setError("");
    try { setP(await clientApi<Podcast>(`/v1/campaigns/${campaignId}/podcast${regenerate ? "?regenerate=1" : ""}`, { method: "POST" })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  /** Without the MP3: the browser's Indian English voices, a different pitch for each host. */
  function speak() {
    if (!p || typeof speechSynthesis === "undefined") return;
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); return; }
    const voices = speechSynthesis.getVoices();
    const indian = voices.filter((v) => /en[-_]IN/i.test(v.lang));
    speechSynthesis.cancel();
    p.script.forEach((x, i) => {
      const u = new SpeechSynthesisUtterance(x.line.replace(/₹\s?([\d.]+)\s?Cr/g, "$1 crore rupees").replace(/₹\s?([\d.]+)\s?L/g, "$1 lakh rupees"));
      const v = indian[x.host === "Priya" ? 0 : Math.min(1, indian.length - 1)] ?? voices.find((vv) => vv.lang.startsWith("en"));
      if (v) u.voice = v;
      u.lang = v?.lang ?? "en-IN";
      u.pitch = x.host === "Priya" ? 1.15 : 0.85;
      if (i === p.script.length - 1) u.onend = () => setSpeaking(false);
      speechSynthesis.speak(u);
    });
    setSpeaking(true);
  }

  return (
    <div className="card pad">
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <b className="small">🎙 Audio podcast ad{p ? ` · about ${p.seconds} s` : ""}</b>
        {p ? <button type="button" className="linklike small" onClick={() => make(true)} disabled={busy}>{busy ? "Making…" : "Make a new one"}</button> : null}
      </div>
      {!p ? (
        <>
          <p className="small muted" style={{ margin: "6px 0 8px" }}>Two hosts talk about your home for about a minute, in Indian English. Use it on Spotify, JioSaavn or radio ads, or share it on WhatsApp.</p>
          <button type="button" className="btn btn-ai sm" onClick={() => make(false)} disabled={busy}>{busy ? "Writing and recording…" : "🎙 Make the podcast"}</button>
        </>
      ) : (
        <>
          {p.audioUrl ? (
            <div style={{ marginTop: 8 }}>
              <audio controls preload="none" src={p.audioUrl} style={{ width: "100%" }} />
              <a href={p.audioUrl} download className="small">⬇ Download MP3</a>
            </div>
          ) : (
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-o sm" onClick={speak}>{speaking ? "■ Stop" : "▶ Listen"}</button>
              <span className="small muted">Read by your browser; the recorded MP3 appears once Text-to-Speech is on.</span>
            </div>
          )}
          <div className="col" style={{ gap: 6, marginTop: 10 }}>
            {p.script.map((x, i) => (
              <p key={i} className="small" style={{ margin: 0 }}><b style={{ color: x.host === "Priya" ? "#C2410C" : "#1D4ED8" }}>{x.host}:</b> {x.line}</p>
            ))}
          </div>
        </>
      )}
      {error ? <p className="small error" style={{ margin: "6px 0 0" }}>{error}</p> : null}
    </div>
  );
}
