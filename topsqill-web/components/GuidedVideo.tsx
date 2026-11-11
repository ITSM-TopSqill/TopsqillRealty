"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clientApi } from "@/lib/api";
import { imageUrl, inr } from "@/lib/format";
import { buildPlan, canPlan } from "@/lib/floorplan";
import type { Walkthrough } from "@/lib/home3d";
import type { Listing } from "@/lib/types";
import { Map3D } from "./Map3D";

/**
 * Topsqill's own guided video of a listing: a presenter voice and captions
 * over the listing's photos, a walk through its 3D layout room by room, the
 * highlights and the neighbourhood map in 3D. Made from the listing itself,
 * so it carries no other site's or channel's name. The words are written by
 * AI from the listing's facts (or by rules when AI is off) and spoken by the
 * viewer's own browser.
 */
type Script = {
  intro: string; photos: string[];
  rooms: { living: string; kitchen: string; master: string; bedroom: string; bath: string; balcony: string; study: string };
  highlights: string; location: string; outro: string;
};
type Scene =
  | { kind: "intro" | "outro" | "highlights"; line: string; image?: string | null }
  | { kind: "photo"; line: string; image: string; label?: string | null }
  | { kind: "tour"; line: string }
  | { kind: "map"; line: string };

export function GuidedVideo({ listing }: { listing: Listing }) {
  const photos = useMemo(() => (listing.media ?? []).filter((m) => m.kind === "image" && m.urls).slice(0, 8), [listing.media]);
  const plan = useMemo(() => (canPlan(listing.kind, listing.bhk, listing.areaSqft) ? buildPlan(listing.bhk!, listing.areaSqft!) : null), [listing]);
  const cover = imageUrl(listing.cover ?? photos[0], "full") ?? imageUrl(photos[0], "full");
  const [script, setScript] = useState<Script | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "done">("idle");
  const [index, setIndex] = useState(0);
  const [caption, setCaption] = useState("");
  const [room, setRoom] = useState("");
  const [muted, setMuted] = useState(false);
  const run = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);

  const scenes: Scene[] = script ? [
    { kind: "intro", line: script.intro, image: cover },
    ...photos.map((p, i) => ({ kind: "photo" as const, line: script.photos[i] ?? "", image: imageUrl(p, "full") ?? "", label: p.label })).filter((s) => s.image && s.line),
    ...(plan ? [{ kind: "tour" as const, line: "" }] : []),
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
    if (me !== run.current) return;
    setIndex(0); setRoom(""); setState("playing");
  }

  function stop() { run.current++; stopVoice(); setState("idle"); setIndex(0); setCaption(""); }

  // Each scene speaks its line, then moves on (the 3D tour moves on when it has been round the home).
  const scene = state === "playing" ? scenes[index] : undefined;
  useEffect(() => {
    if (!scene || scene.kind === "tour") return;
    const me = run.current;
    setCaption(scene.line);
    let gone = false;
    say(scene.line, muted).then(() => wait(scene.kind === "map" ? 2500 : 900)).then(() => {
      if (gone || me !== run.current) return;
      if (index + 1 < scenes.length) setIndex(index + 1); else setState("done");
    });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, index]);

  useEffect(() => () => { run.current++; stopVoice(); }, []);

  const next = () => { if (index + 1 < scenes.length) setIndex(index + 1); else setState("done"); };
  const price = listing.priceInr ? inr(listing.priceInr, listing.purpose === "rent") : "";
  if (!photos.length && !plan) return null;

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
              <span className="small" style={{ textShadow: "0 2px 8px rgba(0,0,0,.6)" }}>Photos, a walk through the layout and the neighbourhood, with a voice guide</span>
            </span>
          </button>
        ) : scene ? (
          <>
            {scene.kind === "tour" && plan ? (
              <Tour key={`tour-${run.current}`} plan={plan} script={script!} muted={muted}
                onRoom={(name, line) => { setRoom(name); setCaption(line); }} onDone={next} />
            ) : scene.kind === "map" ? (
              <div style={{ position: "absolute", inset: 0 }}><Map3D lat={listing.lat!} lng={listing.lng!} label={listing.locality} height={wrap.current?.clientHeight ?? 360} /></div>
            ) : (
              <img key={`${index}-${run.current}`} src={("image" in scene && scene.image) || cover || ""} alt=""
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", animation: `kb${index % 2} 9s ease-out forwards` }} />
            )}
            {scene.kind === "intro" || scene.kind === "outro" ? (
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, padding: "22px 24px 40px", background: "linear-gradient(rgba(10,8,25,.75), transparent)" }}>
                <div style={{ fontSize: "clamp(18px, 3vw, 28px)", fontWeight: 800 }}>{listing.title}</div>
                <div style={{ opacity: 0.9 }}>{[price, `${listing.locality}, ${listing.city}`].filter(Boolean).join(" · ")}</div>
              </div>
            ) : null}
            {scene.kind === "highlights" && (listing.amenities?.length || listing.usps?.length) ? (
              <div style={{ position: "absolute", left: 16, top: 16, right: 16, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[...(listing.usps ?? []), ...(listing.amenities ?? [])].slice(0, 8).map((t, i) => (
                  <span key={t} className="pill" style={{ background: "rgba(255,255,255,.9)", color: "#2b2050", animation: `pop .4s ${i * 0.25}s both` }}>{t}</span>
                ))}
              </div>
            ) : null}
            {scene.kind === "tour" && room ? <span className="pill" style={{ position: "absolute", left: 12, top: 12, background: "rgba(20,16,40,.7)", color: "#fff" }}>{room}</span> : null}
            {scene.kind === "photo" && scene.label ? <span className="pill" style={{ position: "absolute", left: 12, top: 12, background: "rgba(20,16,40,.7)", color: "#fff" }}>{scene.label}</span> : null}
            {caption ? (
              <div style={{ position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)", width: "min(92%, 760px)", textAlign: "center", padding: "8px 14px", borderRadius: 10, background: "rgba(10,8,25,.72)", fontSize: "clamp(13px, 1.8vw, 17px)", lineHeight: 1.35 }}>
                {caption}
              </div>
            ) : null}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: "rgba(255,255,255,.2)" }}>
              <i style={{ display: "block", height: "100%", width: `${((index + 1) / scenes.length) * 100}%`, background: "var(--vio, #7c5cff)", transition: "width .4s" }} />
            </div>
            <button type="button" className="pill" aria-label="Full screen" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen?.())}
              style={{ position: "absolute", right: 10, top: 10, background: "rgba(20,16,40,.6)", color: "#fff", border: 0, cursor: "pointer" }}>⛶</button>
          </>
        ) : null}
      </div>
      <p className="small muted" style={{ margin: "8px 0 0" }}>
        Made by Topsqill from this listing’s photos and details.{plan ? " The walk-through uses an illustrative layout, not the actual floor plan." : ""}
      </p>
      <style>{`@keyframes kb0{from{transform:scale(1) translate(0,0)}to{transform:scale(1.14) translate(-2%,-1%)}}@keyframes kb1{from{transform:scale(1.14) translate(2%,1%)}to{transform:scale(1) translate(0,0)}}@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

/** The 3D layout's guided tour, with the presenter speaking as it enters each kind of room. */
function Tour({ plan, script, muted, onRoom, onDone }: {
  plan: ReturnType<typeof buildPlan>; script: Script; muted: boolean;
  onRoom: (name: string, line: string) => void; onDone: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let ctl: Walkthrough | null = null;
    let gone = false;
    const spoken = new Set<string>();
    let entrances = 0;
    let lastLine = "";
    let queue: Promise<void> = Promise.resolve();
    const timer = setTimeout(() => !gone && onDone(), 150_000);
    import("@/lib/home3d").then(({ mountWalkthrough }) => {
      if (gone || !stage.current) return;
      ctl = mountWalkthrough(stage.current, plan, (name) => {
        if (gone || !name) return;
        if (name === "Entrance" && ++entrances > 1) { void finish(); return; }
        if (entrances > 1) return;
        const kind = roomKind(name, plan.bhk);
        const line = kind && !spoken.has(kind) ? script.rooms[kind] : "";
        if (kind && line) {
          // One line at a time: a room entered while the last one is still being described waits its turn.
          spoken.add(kind);
          queue = queue.then(() => { if (gone) return; lastLine = line; onRoom(name, line); return say(line, muted); });
        } else onRoom(name, lastLine);
      });
      ctl.setMode("tour");
    });
    async function finish() {
      await queue;
      await waitForVoice();
      if (!gone) { gone = true; onDone(); }
    }
    return () => { gone = true; clearTimeout(timer); ctl?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={stage} style={{ position: "absolute", inset: 0 }} />;
}

function roomKind(name: string, bhk: number): keyof Script["rooms"] | null {
  if (/living/i.test(name)) return "living";
  if (/kitchen/i.test(name)) return "kitchen";
  if (/master/i.test(name) || (bhk === 1 && /^bedroom$/i.test(name))) return "master";
  if (/bedroom/i.test(name)) return "bedroom";
  if (/bath/i.test(name)) return "bath";
  if (/balcony/i.test(name)) return "balcony";
  if (/study/i.test(name)) return "study";
  return null;
}

// --- The presenter's voice: the browser's own speech, an Indian English voice where there is one.
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let voice: SpeechSynthesisVoice | null | undefined;
function pickVoice() {
  if (voice !== undefined || typeof speechSynthesis === "undefined") return voice ?? null;
  const all = speechSynthesis.getVoices();
  if (!all.length) return null;
  voice = all.find((v) => v.lang === "en-IN") ?? all.find((v) => /^en[-_](GB|US)/.test(v.lang) && /female|samantha|google/i.test(v.name)) ?? all.find((v) => v.lang.startsWith("en")) ?? null;
  return voice;
}
function say(text: string, muted: boolean): Promise<void> {
  const reading = Math.max(2500, text.split(/\s+/).length * 380);
  if (!text) return wait(1500);
  if (muted || typeof speechSynthesis === "undefined") return wait(reading);
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text.replace(/₹\s?([\d.]+)\s?Cr/g, "$1 crore rupees").replace(/₹\s?([\d.]+)\s?L/g, "$1 lakh rupees").replace(/₹/g, "rupees "));
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-IN";
    u.rate = 0.98;
    let done = false;
    const end = () => { if (!done) { done = true; resolve(); } };
    u.onend = end; u.onerror = end;
    // Some browsers never fire "end"; the reading time is the backstop.
    setTimeout(end, reading + 4000);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
async function waitForVoice() {
  for (let i = 0; i < 40 && typeof speechSynthesis !== "undefined" && speechSynthesis.speaking; i++) await wait(250);
}
function stopVoice() { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }
