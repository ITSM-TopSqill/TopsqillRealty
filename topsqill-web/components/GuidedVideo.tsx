"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clientApi } from "@/lib/api";
import { imageUrl, inr } from "@/lib/format";
import type { Listing, VideoScene } from "@/lib/types";
import { Map3D } from "./Map3D";

/**
 * Topsqill's own guided video of a listing, made only from real footage: the
 * owner's walkthrough clip (with what AI saw in it: "Subtle wall texture",
 * "Modular kitchen"), the listing's real photos with slow cinematic moves,
 * its highlights and the neighbourhood map, narrated by a natural Indian
 * English voice. No 3D models or cartoon scenes. The words are written by AI
 * from the listing's facts (or by rules when AI is off); the voice is Google's
 * Indian English neural voice, or the viewer's browser voice as a fallback.
 */
type Script = {
  intro: string; photos: string[];
  rooms: { living: string; kitchen: string; master: string; bedroom: string; bath: string; balcony: string; study: string };
  highlights: string; location: string; outro: string;
  /** { line: mp3 link } spoken by the Indian English voice. */
  audio?: Record<string, string>;
};
type Scene =
  | { kind: "intro" | "outro" | "highlights"; line: string; image?: string | null }
  | { kind: "photo"; line: string; image: string; label?: string | null }
  | { kind: "clip"; line: string; src: string; items: VideoScene[] }
  | { kind: "map"; line: string };

export function GuidedVideo({ listing }: { listing: Listing }) {
  const photos = useMemo(() => (listing.media ?? []).filter((m) => m.kind === "image" && m.urls).slice(0, 8), [listing.media]);
  // The owner's own walkthrough videos; any showing another site's logo are left out.
  const clips = useMemo(() => (listing.media ?? [])
    .filter((m) => m.kind === "video" && m.status === "ready" && m.urls?.mp4 && !m.scenes?.branded)
    .slice(0, 2).map((m) => ({ src: m.urls!.mp4, items: m.scenes?.items ?? [] })), [listing.media]);
  const cover = imageUrl(listing.cover ?? photos[0], "full") ?? imageUrl(photos[0], "full");
  const [script, setScript] = useState<Script | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "done">("idle");
  const [index, setIndex] = useState(0);
  const [caption, setCaption] = useState("");
  const [room, setRoom] = useState("");
  const [title, setTitle] = useState("");
  const [muted, setMuted] = useState(false);
  const run = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);

  const scenes: Scene[] = script ? [
    { kind: "intro", line: script.intro, image: cover },
    ...clips.map((c) => ({ kind: "clip" as const, line: "", src: c.src, items: c.items })),
    ...photos.slice(0, clips.length ? 4 : 8).map((p, i) => ({ kind: "photo" as const, line: script.photos[i] ?? "", image: imageUrl(p, "full") ?? "", label: p.label })).filter((s) => s.image && s.line),
    { kind: "highlights", line: script.highlights, image: imageUrl(photos[1] ?? photos[0], "full") ?? cover },
    ...(listing.lat != null && listing.lng != null ? [{ kind: "map" as const, line: script.location }] : []),
    { kind: "outro", line: script.outro, image: cover },
  ] : [];

  async function play() {
    const me = ++run.current;
    stopVoice();
    setState("loading");
    let s = script;
    if (!s) {
      s = await clientApi<Script>(`/v1/ai/listings/${listing.id}/video-script`).catch(() => null);
      if (!s) { setState("idle"); return; }
      setScript(s);
    }
    voiceLinks = s.audio ?? {};
    if (me !== run.current) return;
    setIndex(0); setRoom(""); setState("playing");
  }

  function stop() { run.current++; stopVoice(); setState("idle"); setIndex(0); setCaption(""); }

  // Each scene speaks its line, then moves on (a clip moves on when it ends).
  const scene = state === "playing" ? scenes[index] : undefined;
  useEffect(() => {
    if (!scene || scene.kind === "clip") return;
    const me = run.current;
    setCaption(scene.line);
    let gone = false;
    say(scene.line, muted).then(() => wait(scene.kind === "map" ? 2500 : 1100)).then(() => {
      if (gone || me !== run.current) return;
      if (index + 1 < scenes.length) setIndex(index + 1); else setState("done");
    });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, index]);

  useEffect(() => () => { run.current++; stopVoice(); }, []);

  const next = () => { if (index + 1 < scenes.length) setIndex(index + 1); else setState("done"); };
  const price = listing.priceInr ? inr(listing.priceInr, listing.purpose === "rent") : "";
  // Only real footage: without photos or a video there is nothing to film.
  if (!photos.length && !clips.length) return null;

  return (
    <div className="card pad" style={{ marginBottom: 16 }}>
      <div className="spread" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>🎥 Guided video tour</h2>
        {state === "playing" ? (
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="chip" onClick={() => { setMuted((m) => !m); if (!muted) stopVoice(); }}>{muted ? "🔇 Voice off" : "🔊 Voice on"}</button>
            <button type="button" className="chip" onClick={() => { run.current++; stopVoice(); next(); }}>⏭ Skip</button>
            <button type="button" className="chip" onClick={stop}>■ Stop</button>
          </div>
        ) : null}
      </div>
      <div ref={wrap} style={{ position: "relative", aspectRatio: "16/9", borderRadius: 14, overflow: "hidden", background: "#0d0b1a", color: "#fff" }}>
        {state !== "playing" ? (
          <button type="button" onClick={play} disabled={state === "loading"} aria-label="Play the guided video"
            style={{ position: "absolute", inset: 0, border: 0, padding: 0, cursor: "pointer", background: "#0d0b1a", color: "#fff" }}>
            {cover ? <img src={cover} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }} /> : null}
            <span style={{ position: "relative", display: "grid", placeItems: "center", gap: 10 }}>
              <span style={{ width: 74, height: 74, borderRadius: "50%", background: "rgba(255,255,255,.92)", color: "#2b2050", display: "grid", placeItems: "center", fontSize: 30 }}>{state === "loading" ? "…" : state === "done" ? "↻" : "▶"}</span>
              <b style={{ fontSize: 18, textShadow: "0 2px 8px rgba(0,0,0,.6)" }}>{state === "loading" ? "Preparing the tour…" : state === "done" ? "Watch again" : "Watch the guided tour"}</b>
              <span className="small" style={{ textShadow: "0 2px 8px rgba(0,0,0,.6)" }}>Real video and photos of this home, with an Indian voice guide</span>
            </span>
          </button>
        ) : scene ? (
          <>
            {scene.kind === "clip" ? (
              <Clip key={`clip-${index}-${run.current}`} src={scene.src} items={scene.items} muted={muted}
                onScene={(s) => { setRoom(s?.room && s.room !== "Other" ? s.room : ""); setTitle(s?.caption ?? ""); setCaption(s?.line ?? ""); }}
                onDone={() => { setTitle(""); next(); }} />

            ) : scene.kind === "map" ? (
              <div style={{ position: "absolute", inset: 0 }}><Map3D lat={listing.lat!} lng={listing.lng!} label={listing.locality} height={wrap.current?.clientHeight ?? 360} /></div>
            ) : (
              <img key={`${index}-${run.current}`} src={("image" in scene && scene.image) || cover || ""} alt=""
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "contrast(1.04) saturate(1.06)",
                  animation: `kb${index % 3} 12s cubic-bezier(.25,.1,.25,1) forwards, fadein 1.1s ease-out both` }} />
            )}
            {/* Film look: a soft vignette and a darker base for the titles */}
            <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.42) 100%), linear-gradient(transparent 55%, rgba(0,0,0,.55))" }} />
            {scene.kind === "intro" || scene.kind === "outro" ? (
              <LowerThird key={scene.kind} kicker={scene.kind === "intro" ? `${listing.locality}, ${listing.city}` : "Book a site visit"} title={listing.title} sub={price} />
            ) : null}
            {scene.kind === "photo" && scene.label ? <LowerThird key={`l-${index}`} kicker="" title={scene.label} small /> : null}
            {scene.kind === "highlights" && (listing.amenities?.length || listing.usps?.length) ? (
              <div style={{ position: "absolute", left: "5%", top: "12%", display: "grid", gap: 6, pointerEvents: "none" }}>
                <div style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", opacity: 0.85, animation: "fadein .6s both" }}>Highlights</div>
                {[...(listing.usps ?? []), ...(listing.amenities ?? [])].slice(0, 5).map((t, i) => (
                  <div key={t} style={{ fontSize: "clamp(15px, 2.2vw, 22px)", fontWeight: 600, textShadow: "0 2px 10px rgba(0,0,0,.6)", borderLeft: "3px solid #fff", paddingLeft: 10, animation: `rise .6s ${0.3 + i * 0.35}s both` }}>{t}</div>
                ))}
              </div>
            ) : null}
            {scene.kind === "clip" && title ? (
              <div key={title} style={{ position: "absolute", left: 0, right: 0, top: "58%", textAlign: "center", pointerEvents: "none", animation: "pop .5s both" }}>
                <div style={{ display: "inline-block", fontSize: "clamp(22px, 4.4vw, 46px)", fontWeight: 800, color: "#fff", textShadow: "0 3px 14px rgba(0,0,0,.65)", letterSpacing: ".01em" }}>{title}</div>
                <div style={{ width: "min(36%, 300px)", height: 5, margin: "8px auto 0", borderRadius: 4, background: "linear-gradient(90deg, #7c5cff, #2ec4b6)" }} />
              </div>
            ) : null}
            {scene.kind === "clip" && room ? <span className="pill" style={{ position: "absolute", left: 12, top: 12, background: "rgba(20,16,40,.7)", color: "#fff" }}>{room}</span> : null}
            {caption ? (
              <div key={caption} style={{ position: "absolute", left: "50%", bottom: 18, transform: "translateX(-50%)", width: "min(90%, 780px)", textAlign: "center", fontSize: "clamp(13px, 1.9vw, 18px)", lineHeight: 1.4, fontWeight: 500, textShadow: "0 1px 3px rgba(0,0,0,.9), 0 0 12px rgba(0,0,0,.6)", animation: "fadein .4s both" }}>
                {caption}
              </div>
            ) : null}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "rgba(255,255,255,.15)" }}>
              <i style={{ display: "block", height: "100%", width: `${((index + 1) / scenes.length) * 100}%`, background: "rgba(255,255,255,.85)", transition: "width .6s" }} />
            </div>
            <button type="button" className="pill" aria-label="Full screen" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen?.())}
              style={{ position: "absolute", right: 10, top: 10, background: "rgba(20,16,40,.6)", color: "#fff", border: 0, cursor: "pointer" }}>⛶</button>
          </>
        ) : null}
      </div>
      <p className="small muted" style={{ margin: "8px 0 0" }}>
        Made by Topsqill from this listing’s own video, photos and details.
      </p>
      <style>{`@keyframes kb0{from{transform:scale(1.02) translate(0,0)}to{transform:scale(1.12) translate(-2%,-1%)}}@keyframes kb1{from{transform:scale(1.12) translate(2%,1%)}to{transform:scale(1.02) translate(0,0)}}@keyframes kb2{from{transform:scale(1.04) translate(-2%,0)}to{transform:scale(1.1) translate(2%,0)}}@keyframes fadein{from{opacity:0}to{opacity:1}}@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

/**
 * The owner's clip, fitted to the frame over a blurred copy of itself (so
 * upright phone videos fill the screen), sound off, with the AI's caption
 * and narration for each moment. Moves on when it ends, or after 90 seconds.
 */
function Clip({ src, items, muted, onScene, onDone }: { src: string; items: VideoScene[]; muted: boolean; onScene: (s: VideoScene | null) => void; onDone: () => void }) {
  const fg = useRef<HTMLVideoElement>(null);
  const bg = useRef<HTMLVideoElement>(null);
  const shown = useRef(-1);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const ended = useRef(false);
  useEffect(() => {
    ended.current = false;
    const cap = setTimeout(() => finish(), 90_000);
    fg.current?.play().catch(() => finish());
    return () => { clearTimeout(cap); ended.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function finish() {
    if (ended.current) return;
    ended.current = true;
    fg.current?.pause();
    void queue.current.then(() => onDone());
  }
  function tick() {
    const v = fg.current;
    if (!v) return;
    if (bg.current && Math.abs(bg.current.currentTime - v.currentTime) > 0.3) bg.current.currentTime = v.currentTime;
    let i = -1;
    for (let n = 0; n < items.length; n++) if (items[n].t - 1 <= v.currentTime) i = n;
    if (i === shown.current || i < 0) return;
    shown.current = i;
    const s = items[i];
    onScene(s);
    // Narration one line at a time; if the video runs ahead, older lines are dropped.
    if (s.line && pending.current < 1) {
      pending.current++;
      queue.current = queue.current.then(() => say(s.line, muted)).finally(() => { pending.current--; });
    }
  }
  const fill: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };
  return (
    <>
      <video ref={bg} src={src} muted playsInline autoPlay aria-hidden style={{ ...fill, objectFit: "cover", filter: "blur(22px) brightness(.55)", transform: "scale(1.15)" }} />
      <video ref={fg} src={src} muted playsInline onTimeUpdate={tick} onEnded={finish} onError={finish} style={{ ...fill, objectFit: "contain" }} />
    </>
  );
}

/** A broadcast-style title in the lower left: a small kicker, the title, and a line under it. */
function LowerThird({ kicker, title, sub, small = false }: { kicker: string; title: string; sub?: string; small?: boolean }) {
  return (
    <div style={{ position: "absolute", left: "5%", bottom: small ? "16%" : "18%", maxWidth: "70%", pointerEvents: "none" }}>
      {kicker ? <div style={{ fontSize: 12, letterSpacing: ".22em", textTransform: "uppercase", opacity: 0.9, animation: "rise .6s .2s both" }}>{kicker}</div> : null}
      <div style={{ fontSize: small ? "clamp(16px, 2.4vw, 24px)" : "clamp(20px, 3.6vw, 36px)", fontWeight: 700, lineHeight: 1.15, textShadow: "0 2px 12px rgba(0,0,0,.55)", animation: "rise .7s .35s both" }}>{title}</div>
      <div style={{ width: 64, height: 2, background: "#fff", margin: "8px 0 6px", animation: "fadein .6s .6s both" }} />
      {sub ? <div style={{ fontSize: "clamp(14px, 2vw, 20px)", fontWeight: 600, animation: "rise .6s .7s both" }}>{sub}</div> : null}
    </div>
  );
}

// --- The presenter's voice: the browser's own speech, an Indian English voice where there is one.
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let voice: SpeechSynthesisVoice | null | undefined;
function pickVoice() {
  if (voice !== undefined || typeof speechSynthesis === "undefined") return voice ?? null;
  const all = speechSynthesis.getVoices();
  if (!all.length) return null;
  // An Indian English voice ("Google English (India)", "Rishi", "Veena"…) wherever the device has one.
  voice = all.find((v) => /en[-_]IN/i.test(v.lang) && /google|natural|neural/i.test(v.name)) ?? all.find((v) => /en[-_]IN/i.test(v.lang))
    ?? all.find((v) => v.lang.startsWith("en")) ?? null;
  return voice;
}
/** Lines spoken by the Indian English voice, from the script: { line: mp3 link }. */
let voiceLinks: Record<string, string> = {};
let playing: HTMLAudioElement | null = null;

function say(text: string, muted: boolean): Promise<void> {
  const reading = Math.max(2500, text.split(/\s+/).length * 380);
  if (!text) return wait(1500);
  if (muted) return wait(reading);
  const link = voiceLinks[text.trim()];
  if (link) {
    return new Promise((resolve) => {
      const a = new Audio(link);
      playing = a;
      let done = false;
      const end = () => { if (!done) { done = true; if (playing === a) playing = null; resolve(); } };
      a.onended = end;
      // If the file can't play, the browser's own voice says the line instead.
      a.onerror = () => { if (!done) { done = true; browserSay(text).then(resolve); } };
      setTimeout(end, reading + 15_000);
      a.play().catch(() => { if (!done) { done = true; browserSay(text).then(resolve); } });
    });
  }
  return browserSay(text);
}

function browserSay(text: string): Promise<void> {
  const reading = Math.max(2500, text.split(/\s+/).length * 380);
  if (typeof speechSynthesis === "undefined") return wait(reading);
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text.replace(/₹\s?([\d.]+)\s?Cr/g, "$1 crore rupees").replace(/₹\s?([\d.]+)\s?L/g, "$1 lakh rupees").replace(/₹/g, "rupees "));
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-IN";
    u.rate = 0.98;
    let done = false;
    const end = () => { if (!done) { done = true; resolve(); } };
    u.onend = end; u.onerror = end;
    setTimeout(end, reading + 4000);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
function stopVoice() {
  playing?.pause(); playing = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
