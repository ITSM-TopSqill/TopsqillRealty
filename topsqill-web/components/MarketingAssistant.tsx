"use client";

import { useEffect, useRef, useState } from "react";
import { clientApi } from "@/lib/api";

type Reply = { reply: string; source: "claude" | "rules" };
type Msg = { role: "user" | "assistant"; text: string; error?: boolean };

const STARTERS = [
  "How much did we spend this month?",
  "Which campaign generated the most qualified leads?",
  "Which locality is producing the best results?",
  "Which leads should I follow up with today?",
  "Compare the performance of all my campaigns",
];

/**
 * Phase 6: a chat over the member's own real campaign, spend and lead data -
 * the AI Marketing Orchestrator's conversational layer. It never takes an
 * action itself (no launching, pausing or budget changes) - it only answers
 * questions, backed by the same numbers the Insights page shows.
 */
export function MarketingAssistant() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);

  async function send(raw?: string) {
    const message = (raw ?? text).trim();
    if (!message || busy) return;
    setText("");
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await clientApi<Reply>("/v1/campaigns/assistant", { method: "POST", body: { message, history: history.slice(-12) } });
      setMsgs((m) => [...m, { role: "assistant", text: res.reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: (e as Error).message || "Something went wrong. Please try again.", error: true }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <div className="card pad" style={{ marginTop: 20 }}>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>🤖</span>
        <b>Ask about your marketing</b>
      </div>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Plain-language questions about your real spend, leads and campaigns. It answers from your actual numbers and never launches, pauses or changes anything on its own.
      </p>

      {msgs.length === 0 ? (
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {STARTERS.map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)}>{s}</button>)}
        </div>
      ) : (
        <div className="col" style={{ gap: 10, marginBottom: 12, maxHeight: 360, overflowY: "auto" }}>
          {msgs.map((m, i) => (
            <div key={i} className={`asst-turn ${m.role}`}>
              <div className={`asst-bub ${m.role} ${m.error ? "err" : ""}`} style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
            </div>
          ))}
          {busy ? <div className="asst-turn assistant"><div className="asst-bub assistant asst-typing" aria-label="Thinking"><span /><span /><span /></div></div> : null}
          <div ref={bottom} />
        </div>
      )}

      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={1000}
          placeholder="e.g. “Why is our cost per qualified lead going up?”" aria-label="Ask about your marketing"
          style={{ flex: 1 }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn btn-ai" disabled={busy || !text.trim()}>{busy ? "…" : "Ask"}</button>
      </form>
      {msgs.length ? <button type="button" className="linklike small" style={{ marginTop: 8 }} onClick={() => setMsgs([])}>Start a new chat</button> : null}
    </div>
  );
}
