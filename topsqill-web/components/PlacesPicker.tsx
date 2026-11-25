"use client";

import { useEffect, useState } from "react";
import { clientApi } from "@/lib/api";

export type PickedPlace = { label: string; lat: number; lng: number; radiusKm: number };
type SearchHit = { label: string; lat: number; lng: number; locality: string | null; city: string | null };

const MAX = 8;

/**
 * Adds extra localities to target (or to exclude) besides a campaign's
 * primary point - India has no real postal-code targeting on Meta or Google,
 * so each one is its own point and radius, same as the primary location.
 */
export function PlacesPicker({ label, hint, value, onChange }: {
  label: string; hint?: string; value: PickedPlace[]; onChange: (v: PickedPlace[]) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Suggestions as you type (after a short pause, at least 3 letters) - same debounce as LocationPicker.
  useEffect(() => {
    const text = q.trim();
    if (text.length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await clientApi<{ items: SearchHit[] }>(`/v1/geo/search?q=${encodeURIComponent(text)}`).catch(() => ({ items: [] as SearchHit[] }));
      setResults(r.items); setSearching(false);
    }, 450);
    return () => clearTimeout(t);
  }, [q]);

  function add(hit: SearchHit) {
    if (value.length >= MAX || value.some((p) => p.label === hit.label)) { setQ(""); setResults([]); return; }
    onChange([...value, { label: hit.label, lat: hit.lat, lng: hit.lng, radiusKm: 5 }]);
    setQ(""); setResults([]);
  }

  function setRadius(i: number, radiusKm: number) {
    onChange(value.map((p, idx) => (idx === i ? { ...p, radiusKm: Math.min(Math.max(radiusKm, 1), 50) } : p)));
  }

  function remove(i: number) { onChange(value.filter((_, idx) => idx !== i)); }

  return (
    <div className="field">
      <label>{label}</label>
      {hint ? <p className="muted small" style={{ margin: "0 0 6px" }}>{hint}</p> : null}
      {value.length ? (
        <div className="col" style={{ gap: 6, marginBottom: 8 }}>
          {value.map((p, i) => (
            <div key={`${p.lat},${p.lng}`} className="row spread" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", gap: 8 }}>
              <span className="small">📍 {p.label}</span>
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <input type="number" min={1} max={50} value={p.radiusKm} onChange={(e) => setRadius(i, Number(e.target.value))} style={{ width: 56 }} aria-label={`Radius around ${p.label}, in kilometres`} />
                <span className="small muted">km</span>
                <button type="button" className="linklike small" onClick={() => remove(i)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {value.length < MAX ? (
        <div style={{ position: "relative" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a locality or area to add" aria-label={label} />
          {q.trim().length >= 3 ? (
            <div className="card" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 20, padding: 4, maxHeight: 240, overflow: "auto", boxShadow: "0 10px 30px rgba(20,16,40,.16)" }}>
              {searching ? <div className="small muted" style={{ padding: "8px 10px" }}>Searching…</div> : null}
              {!searching && !results.length ? <div className="small muted" style={{ padding: "8px 10px" }}>No match.</div> : null}
              {results.map((r) => (
                <button key={`${r.lat},${r.lng}`} type="button" className="linklike small" style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px" }} onClick={() => add(r)}>
                  📍 <b>{r.label}</b>{r.city ? <span className="muted"> · {r.city}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : <p className="small muted">Up to {MAX} areas.</p>}
    </div>
  );
}
