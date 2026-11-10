"use client";

import { useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";

type Turn = { role: "user" | "assistant"; text: string };

/**
 * "Ask about this listing": quick answers from the listing's own facts,
 * the locality's prices and similar homes. Anything it can't know, it says so
 * and points to the seller.
 */
export function ListingAsk({ listingId, signedIn, rent }: { listingId: string; signedIn: boolean; rent: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const suggestions = rent
    ? ["Is the rent fair for this area?", "Is it furnished?", "What amenities are there?", "When can I move in?"]
    : ["Is the price fair?", "What would the EMI be?", "Is it ready to move?", "What amenities are there?"];

  async function ask(raw?: string) {
    const question = (raw ?? q).trim();
    if (!question || busy) return;
    setQ("");
    const history = turns.slice(-6);
    setTurns((t) => [...t, { role: "user", text: question }]);
    setBusy(true);
    try {
      const res = await clientApi<{ answer: string }>(`/v1/ai/listings/${listingId}/ask`, { method: "POST", body: { message: question, history } });
      setTurns((t) => [...t, { role: "assistant", text: res.answer }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", text: (e as Error).message || "Couldn’t answer that just now. Please try again." }]);
    } finally { setBusy(false); }
  }

  return (
    <section className="card pad aiq" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>✨ Ask about this home</h2>
      <p className="small muted" style={{ marginBottom: 10 }}>Answers come from this listing and prices in the area. For anything else, the seller is one tap away.</p>

      {signedIn ? (
        <>
          {turns.length ? (
            <div className="col" style={{ gap: 8, marginBottom: 10 }}>
              {turns.map((t, i) => t.role === "user"
                ? <b key={i} style={{ fontSize: 14 }}>{t.text}</b>
                : <div key={i} className="aiq-a">{t.text}</div>)}
              {busy ? <div className="aiq-a muted">Thinking…</div> : null}
            </div>
          ) : null}
          <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {suggestions.filter((s) => !turns.some((t) => t.text === s)).map((s) => (
              <button key={s} className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>
            ))}
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); ask(); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="Ask a question about this home…" aria-label="Ask a question about this home"
              style={{ flex: 1, height: 40, borderRadius: 999, border: "1.5px solid var(--line)", padding: "0 14px", background: "var(--card)", color: "var(--ink)" }} />
            <button className="btn btn-ai sm" disabled={busy || !q.trim()}>{busy ? "…" : "Ask"}</button>
          </form>
        </>
      ) : (
        <Link href={`/signin?next=/listings/${listingId}`} className="btn btn-o sm">Sign in to ask</Link>
      )}
    </section>
  );
}
