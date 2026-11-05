"use client";

import { useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";
import { inr } from "@/lib/format";

type Match = { id: string; title: string; priceInr?: number | null; purpose: string; locality: string; score: number };

/** Shows the listings the backend has already matched to this requirement. */
export function MatchesButton({ requirementId }: { requirementId: string }) {
  const [items, setItems] = useState<Match[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (items) { setItems(null); return; }
    setBusy(true);
    try {
      const res = await clientApi<{ items: Match[] }>(`/v1/requirements/${requirementId}/matches`);
      setItems(res.items ?? []);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ width: "100%" }}>
      <button className="btn btn-o sm" onClick={load} disabled={busy}>
        {busy ? "Matching…" : items ? "Hide matches" : "See matching listings"}
      </button>
      {items ? (
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
          {items.length ? items.map((m) => (
            <Link key={m.id} href={`/listings/${m.id}`} className="card row" style={{ padding: 10, textDecoration: "none" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{m.title}</b>
                <span className="small muted" style={{ display: "block" }}>
                  {inr(m.priceInr, m.purpose === "rent")} · {m.locality}
                </span>
              </span>
              <span style={{ fontWeight: 800, color: "#12B76A" }}>{m.score}%</span>
            </Link>
          )) : <p className="small muted">No strong matches yet. New listings are checked automatically.</p>}
        </div>
      ) : null}
    </div>
  );
}
