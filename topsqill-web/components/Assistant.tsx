"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";
import { Avatar, ListingCard, TypePill } from "./ui";
import type { Listing } from "@/lib/types";

type Person = { id: string; name: string; type?: string; headline?: string | null; city?: string | null };
type Locality = { id: string; locality: string; city: string; listings: number; avgRatePerSqft: number; medianPrice: number };
type JobCard = { id: string; title: string; company: string; city: string; employment?: string };
type Reply = { reply: string; listings: Listing[]; people: Person[]; localities: Locality[]; jobs: JobCard[]; source: "claude" | "rules" };
type Msg = { role: "user" | "assistant"; text: string; cards?: Omit<Reply, "reply" | "source">; error?: boolean };

const KEY = "topsqill:assistant";
const STARTERS = [
  "3 BHK in Gurgaon under 3 Cr",
  "What’s the price per sq ft on Golf Course Road?",
  "Estimate a fair price for 1,800 sq ft in Sohna Road",
  "Which of my leads should I call today?",
  "Find builders in Noida",
  "Write a post about a new 4 BHK launch in Sector 150 Noida",
];

/**
 * "Ask Topsqill.ai": search, matching, pricing and writing in one chat.
 * The conversation is kept for this browser tab, so moving between pages
 * doesn't lose it.
 */
export function Assistant({ firstName }: { firstName: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { const saved = sessionStorage.getItem(KEY); if (saved) setMsgs(JSON.parse(saved)); } catch { /* fresh chat */ }
    // A question can arrive from the top bar: /assistant?q=...
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) { window.history.replaceState(null, "", "/assistant"); setTimeout(() => send(q), 0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* storage full or blocked */ }
    // A new answer is shown from its first line (cards follow below it);
    // the member's own message just scrolls to the bottom.
    const last = log.current?.lastElementChild?.previousElementSibling as HTMLElement | null;
    if (msgs.at(-1)?.role === "assistant" && last) last.scrollIntoView({ behavior: "smooth", block: "start" });
    else bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  async function send(raw?: string) {
    const message = (raw ?? text).trim();
    if (!message || busy) return;
    setText("");
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await clientApi<Reply>("/v1/ai/assistant", { method: "POST", body: { message, history: history.slice(-12) } });
      setMsgs((m) => [...m, { role: "assistant", text: res.reply, cards: { listings: res.listings, people: res.people, localities: res.localities, jobs: res.jobs } }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: (e as Error).message || "Something went wrong. Please try again.", error: true }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  function copy(t: string) { navigator.clipboard?.writeText(t).catch(() => {}); }

  return (
    <div className="card asst">
      <div className="asst-log" aria-live="polite" ref={log}>
        {msgs.length === 0 ? (
          <div className="asst-hello">
            <div className="asst-mark" aria-hidden>✨</div>
            <h1 style={{ fontSize: 24 }}>Hi {firstName}, what can I find for you?</h1>
            <p className="muted" style={{ margin: "6px 0 16px", maxWidth: "52ch" }}>
              Ask in plain words, in English or Hinglish. I search live listings, compare prices, check your leads and requirements, and write posts and messages.
            </p>
            <div className="row" style={{ flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {STARTERS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        ) : null}

        {msgs.map((m, i) => (
          <div key={i} className={`asst-turn ${m.role}`}>
            <div className={`asst-bub ${m.role} ${m.error ? "err" : ""}`}>
              {m.text}
              {m.role === "assistant" && !m.error && m.text.length > 120 ? (
                <button className="linklike small" style={{ display: "block", marginTop: 6 }} onClick={() => copy(m.text)}>Copy</button>
              ) : null}
            </div>
            {m.cards ? <Cards cards={m.cards} /> : null}
          </div>
        ))}
        {busy ? <div className="asst-turn assistant"><div className="asst-bub assistant asst-typing" aria-label="Thinking"><span /><span /><span /></div></div> : null}
        <div ref={bottom} />
      </div>

      <form className="asst-box" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={1000}
          placeholder="Ask anything: “2 BHK on rent in Powai under 60k”, “Is ₹2.4 Cr fair for 1,650 sq ft in Sector 82?”"
          aria-label="Ask Topsqill.ai"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn btn-ai" disabled={busy || !text.trim()}>{busy ? "…" : "Ask"}</button>
      </form>
      {msgs.length ? (
        <button className="linklike small" style={{ alignSelf: "center", margin: "0 0 10px", color: "var(--ink3)" }}
          onClick={() => { setMsgs([]); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }}>
          Start a new chat
        </button>
      ) : null}
    </div>
  );
}

function Cards({ cards }: { cards: Omit<Reply, "reply" | "source"> }) {
  return (
    <div className="col" style={{ gap: 10, marginTop: 8, width: "100%" }}>
      {cards.localities.length ? (
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {cards.localities.map((l) => (
            <Link key={l.id} href={`/search?q=${encodeURIComponent(l.locality)}`} className="card pad" style={{ padding: "10px 14px", textDecoration: "none" }}>
              <b>📍 {l.locality}, {l.city}</b>
              <div className="small muted">₹{Number(l.avgRatePerSqft).toLocaleString("en-IN")}/sq ft · {l.listings} live listings</div>
            </Link>
          ))}
        </div>
      ) : null}
      {cards.listings.length ? <div className="lgrid asst-grid">{cards.listings.map((l) => <ListingCard key={l.id} listing={l} />)}</div> : null}
      {cards.people.length ? (
        <div className="col" style={{ gap: 6 }}>
          {cards.people.map((p) => (
            <Link key={p.id} href={`/profile/${p.id}`} className="card row" style={{ padding: "8px 12px", textDecoration: "none" }}>
              <Avatar person={{ id: p.id, name: p.name, type: p.type }} size={36} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="row" style={{ gap: 6 }}><b>{p.name}</b><TypePill type={p.type} /></span>
                <span className="small muted ell" style={{ display: "block" }}>{p.headline ?? p.city}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
      {cards.jobs.length ? (
        <div className="col" style={{ gap: 6 }}>
          {cards.jobs.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card" style={{ padding: "10px 14px", textDecoration: "none" }}>
              <b>💼 {j.title}</b> <span className="small muted">· {j.company} · {j.city}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
