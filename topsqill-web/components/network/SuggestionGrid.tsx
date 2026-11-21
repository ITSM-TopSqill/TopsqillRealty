"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { Avatar, TypePill } from "@/components/ui";
import { refreshCounts } from "@/components/Live";
import { openChat } from "@/components/MessageDock";
import type { NetPerson } from "./types";

// Lets the two buttons share the card's width without ever overflowing it.
const btnFlex: React.CSSProperties = {
  flex: "1 1 120px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

/**
 * People you may know, as cards: why they're suggested, connect or message
 * in one tap, and load more. Suggestions stay put rather than being
 * dismissable, so the same useful match isn't lost by an accidental tap.
 */
export function SuggestionGrid({ initial, nextOffset, type }: { initial: NetPerson[]; nextOffset: number | null; type: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [next, setNext] = useState(nextOffset);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function connect(id: string) {
    setBusy(id); setError("");
    try { await clientApi(`/v1/profiles/${id}/connect`, { method: "POST" }); setSent((s) => new Set(s).add(id)); refreshCounts(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function message(id: string) {
    setBusy(`msg:${id}`); setError("");
    try {
      const convo = await clientApi<{ id: string }>(`/v1/conversations/with/${id}`, { method: "POST" });
      if (!openChat(convo.id)) router.push(`/messages?c=${convo.id}`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function more() {
    if (next == null) return;
    setBusy("more");
    try {
      const r = await clientApi<{ items: NetPerson[]; nextOffset: number | null }>(`/v1/connections/suggestions?limit=12&offset=${next}${type ? `&type=${type}` : ""}`);
      setItems((x) => [...x, ...r.items.filter((p) => !x.some((y) => y.id === p.id))]);
      setNext(r.nextOffset);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  if (!items.length) return <p className="small muted" style={{ padding: "18px 0" }}>No more suggestions right now. New members in your city will appear here.</p>;
  return (
    <>
      <div className="nw-grid">
        {items.map((p) => (
          <article key={p.id} className="nw-card">
            <div className="nw-cover" style={{ background: `linear-gradient(135deg, color-mix(in srgb, var(--vio) 30%, transparent), color-mix(in srgb, #12B76A 20%, transparent))` }} />
            <Link href={`/profile/${p.id}`} className="nw-cav"><Avatar person={p} media={p.avatar ?? null} size={72} /></Link>
            <div className="nw-cbody">
              <Link href={`/profile/${p.id}`} className="nw-name" style={{ display: "block" }}>{p.name}</Link>
              <div className="row" style={{ gap: 4, justifyContent: "center", flexWrap: "wrap", margin: "4px 0" }}>
                <TypePill type={p.type} />
                {p.kycVerified ? <span className="nw-badge" style={{ color: "#4A86D4" }}>✓ KYC</span> : null}
                {p.reraVerified ? <span className="nw-badge" style={{ color: "#2E9E90" }}>✓ RERA</span> : null}
              </div>
              <p className="nw-head" style={{ minHeight: 36, WebkitLineClamp: 2 }}>{p.headline || p.agency || (p.city ? `Based in ${p.city}` : "")}</p>
              <p className="nw-reason">{p.reason}</p>
            </div>
            <div className="row nw-cbtn" style={{ gap: 6, flexWrap: "wrap" }}>
              {sent.has(p.id)
                ? <span className="btn btn-g sm" style={btnFlex} aria-live="polite">✓ Invitation sent</span>
                : <button className="btn btn-o sm" style={btnFlex} onClick={() => connect(p.id)} disabled={!!busy}>{busy === p.id ? "Sending…" : "+ Connect"}</button>}
              <button className="btn btn-p sm" style={btnFlex} onClick={() => message(p.id)} disabled={!!busy}>{busy === `msg:${p.id}` ? "Opening…" : "💬 Message"}</button>
            </div>
          </article>
        ))}
      </div>
      {error ? <p className="error small" role="alert">{error}</p> : null}
      {next != null ? (
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button className="btn btn-g" onClick={more} disabled={busy === "more"}>{busy === "more" ? "Loading…" : "Show more people"}</button>
        </div>
      ) : null}
    </>
  );
}
