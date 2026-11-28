"use client";

import { useEffect, useState } from "react";
import { clientApi } from "@/lib/api";
import type { Competitor, CompetitorCategory } from "@/lib/types";

const CATEGORIES: { value: CompetitorCategory; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "indirect", label: "Indirect" },
  { value: "substitute", label: "Substitute" },
  { value: "emerging", label: "Emerging" },
  { value: "premium", label: "Premium" },
  { value: "price_focused", label: "Price-focused" },
  { value: "market_leader", label: "Market leader" },
  { value: "regional", label: "Regional" },
];

type Business = { id: string; name: string };

/**
 * Competitor Discovery (Module 1): the member's own list of tracked
 * competitors, added by hand or suggested by AI from a business profile.
 * A suggestion is always shown with its rationale and stays "suggested"
 * until the member explicitly accepts or rejects it - never auto-accepted.
 */
export function CompetitorDiscovery({ onSelect }: { onSelect: (c: Competitor) => void }) {
  const [items, setItems] = useState<Competitor[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [category, setCategory] = useState<CompetitorCategory>("direct");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { refresh(); loadBusinesses(); }, []);

  function refresh() {
    clientApi<{ items: Competitor[] }>("/v1/competitive-intelligence/competitors").then((r) => setItems(r.items)).catch(() => {});
  }
  function loadBusinesses() {
    clientApi<{ items: Business[] }>("/v1/business").then((r) => { setBusinesses(r.items); if (r.items[0]) setBusinessId(r.items[0].id); }).catch(() => {});
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError("");
    try {
      await clientApi("/v1/competitive-intelligence/competitors", { method: "POST", body: { name, website: website || undefined, category } });
      setName(""); setWebsite(""); setCategory("direct");
      refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function suggest() {
    if (!businessId) { setError("Add a business profile first, so suggestions are grounded in it."); return; }
    setSuggesting(true); setError("");
    try {
      await clientApi("/v1/competitive-intelligence/competitors/suggest", { method: "POST", body: { businessId } });
      refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setSuggesting(false); }
  }

  async function setStatus(id: string, status: "accepted" | "rejected") {
    try { await clientApi(`/v1/competitive-intelligence/competitors/${id}`, { method: "PATCH", body: { status } }); refresh(); }
    catch (err) { setError((err as Error).message); }
  }

  async function remove(id: string) {
    try { await clientApi(`/v1/competitive-intelligence/competitors/${id}`, { method: "DELETE" }); refresh(); }
    catch (err) { setError((err as Error).message); }
  }

  const suggested = items.filter((c) => c.status === "suggested");
  const tracked = items.filter((c) => c.status !== "suggested");

  return (
    <div className="card pad">
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <b>Competitors</b>
        {businesses.length ? (
          <div className="row" style={{ gap: 6 }}>
            <select value={businessId} onChange={(e) => setBusinessId(e.target.value)} style={{ fontSize: 13 }}>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button type="button" className="btn btn-o sm" disabled={suggesting} onClick={suggest}>
              {suggesting ? "Thinking…" : "✨ Suggest competitors"}
            </button>
          </div>
        ) : (
          <span className="small muted">Add a business profile to get AI suggestions.</span>
        )}
      </div>

      <form onSubmit={add} className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 180px", margin: 0 }}>
          <label htmlFor="comp-name">Name</label>
          <input id="comp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Competitor name" />
        </div>
        <div className="field" style={{ flex: "1 1 160px", margin: 0 }}>
          <label htmlFor="comp-site">Website (optional)</label>
          <input id="comp-site" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.com" />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="comp-cat">Category</label>
          <select id="comp-cat" value={category} onChange={(e) => setCategory(e.target.value as CompetitorCategory)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <button className="btn btn-ai" disabled={busy || !name.trim()}>{busy ? "Adding…" : "Add"}</button>
      </form>
      {error ? <p className="error small" style={{ marginTop: 8 }}>{error}</p> : null}

      {suggested.length ? (
        <div className="col" style={{ gap: 6, marginTop: 12 }}>
          <span className="small muted">AI-suggested - review before tracking</span>
          {suggested.map((c) => (
            <div key={c.id} className="card pad" style={{ background: "color-mix(in srgb,#6A3FE0 6%,transparent)" }}>
              <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
                <b className="small">{c.name}</b>
                <CategoryPill category={c.category} />
              </div>
              {c.rationale ? <p className="small muted" style={{ marginTop: 4 }}>{c.rationale}</p> : null}
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <button type="button" className="btn btn-ai sm" onClick={() => setStatus(c.id, "accepted")}>Accept</button>
                <button type="button" className="btn btn-g sm" onClick={() => setStatus(c.id, "rejected")}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tracked.length ? (
        <div className="col" style={{ gap: 6, marginTop: 12 }}>
          {tracked.map((c) => (
            <div key={c.id} className="spread" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="linklike small" style={{ textAlign: "left" }} onClick={() => onSelect(c)} title="Search this competitor's ads">
                {c.name}
              </button>
              <div className="row" style={{ gap: 6 }}>
                <CategoryPill category={c.category} />
                {c.status === "rejected" ? <span className="small muted">rejected</span> : null}
                <button type="button" className="linklike small" onClick={() => remove(c.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      ) : !suggested.length ? <p className="small muted" style={{ marginTop: 10 }}>No competitors tracked yet.</p> : null}
    </div>
  );
}

function CategoryPill({ category }: { category: CompetitorCategory }) {
  const label = CATEGORIES.find((c) => c.value === category)?.label ?? category;
  return <span className="pill small" style={{ background: "color-mix(in srgb,#8D8AA3 16%,transparent)" }}>{label}</span>;
}
