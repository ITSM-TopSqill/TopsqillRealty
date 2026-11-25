"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";
import type { PickedPlace } from "./PlacesPicker";

type Suggestion = {
  goal: string; budgetInr: number;
  areas: { label: string; lat: number; lng: number; radiusKm: number; reason: string }[];
  rationale: string; source: "claude" | "rules";
};

/**
 * Phase 2 of the AI campaign manager: describe the buyer in plain words and
 * get back a reviewable goal, budget and a few real localities with the
 * reasoning behind each - nothing is applied until the advertiser picks
 * "Use this", and any area can be unchecked first.
 */
export function AudienceSuggest({ listingId, city, onApply }: {
  listingId?: string; city?: string;
  onApply: (v: { goal: string; budgetInr: number; areas: PickedPlace[] }) => void;
}) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Suggestion | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  async function suggest() {
    if (!description.trim()) { setError("Describe who you're trying to reach."); return; }
    setError(""); setBusy(true); setResult(null);
    try {
      const r = await clientApi<Suggestion>("/v1/campaigns/suggest-audience", {
        method: "POST", body: { description: description.trim(), listingId, city },
      });
      setResult(r);
      setPicked(new Set(r.areas.map((_, i) => i)));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  function toggle(i: number) {
    setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  }

  function apply() {
    if (!result) return;
    onApply({
      goal: result.goal, budgetInr: result.budgetInr,
      areas: result.areas.filter((_, i) => picked.has(i)).map((a) => ({ label: a.label, lat: a.lat, lng: a.lng, radiusKm: a.radiusKm })),
    });
    setResult(null); setDescription("");
  }

  return (
    <div className="card pad" style={{ marginBottom: 12 }}>
      <label htmlFor="audience-desc" style={{ fontWeight: 700 }}>✨ Describe your ideal buyer (optional)</label>
      <p className="muted small" style={{ margin: "2px 0 8px" }}>e.g. &ldquo;Working professionals looking for a 3BHK near IT parks, budget 1.2&ndash;1.5 crore&rdquo;</p>
      <textarea id="audience-desc" rows={2} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who is this ad for?" />
      <button type="button" className="btn btn-o sm" style={{ marginTop: 8 }} onClick={suggest} disabled={busy}>{busy ? "Thinking…" : "Get AI suggestions"}</button>
      {error ? <p className="error small" style={{ marginTop: 8 }}>{error}</p> : null}
      {result ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <p className="small">{result.rationale}</p>
          <p className="small" style={{ fontWeight: 700 }}>Goal: {result.goal} · Suggested budget: ₹{result.budgetInr.toLocaleString("en-IN")}</p>
          {result.areas.length ? (
            <div className="col" style={{ gap: 6, marginTop: 6 }}>
              {result.areas.map((a, i) => (
                <label key={`${a.lat},${a.lng}`} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} style={{ marginTop: 3 }} />
                  <span className="small"><b>{a.label}</b> — {a.reason}</span>
                </label>
              ))}
            </div>
          ) : <p className="small muted" style={{ marginTop: 6 }}>No specific localities suggested.</p>}
          <button type="button" className="btn btn-ai sm" style={{ marginTop: 10 }} onClick={apply}>Use this</button>
        </div>
      ) : null}
    </div>
  );
}
