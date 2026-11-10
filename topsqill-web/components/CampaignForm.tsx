"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { inr } from "@/lib/format";
import type { MyListing } from "@/lib/types";

const GOALS = ["Qualified buyers", "Site visits", "Brand awareness", "Tenants"];
const BUDGETS = [15000, 30000, 50000, 100000];
const STEPS = ["Reading buyer demand near the listing", "Choosing audiences and pincodes", "Writing ads in every format", "Forecasting leads"];

export function CampaignForm({ listings, preselect }: { listings: MyListing[]; preselect?: string }) {
  const router = useRouter();
  const [listingId, setListingId] = useState(listings.some((l) => l.id === preselect) ? preselect! : listings[0].id);
  const [goal, setGoal] = useState(GOALS[0]);
  const [budget, setBudget] = useState(30000);
  const [days, setDays] = useState(15);
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState(-1);
  const [error, setError] = useState("");

  async function build(e: React.FormEvent) {
    e.preventDefault();
    if (budget < 5000) { setError("The minimum budget is ₹5,000."); return; }
    setError(""); setStep(0);
    // The steps tick along while the server works, so the wait reads as progress.
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 900);
    try {
      const c = await clientApi<{ id: string }>("/v1/campaigns", {
        method: "POST", body: { listingId, goal, budgetInr: budget, days, notes: notes.trim() || undefined },
      });
      router.push(`/campaigns/${c.id}`);
    } catch (err) { setError((err as Error).message); setStep(-1); }
    finally { clearInterval(timer); }
  }

  if (step >= 0) {
    return (
      <div className="card pad" aria-live="polite">
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>Building your campaign…</h2>
        {STEPS.map((s, i) => (
          <div key={s} className="row" style={{ gap: 10, padding: "6px 0", fontWeight: 700, color: i <= step ? "var(--ink)" : "var(--ink3)" }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", color: "#fff", fontSize: 12,
              background: i < step ? "#12B76A" : i === step ? "var(--brand)" : "var(--chip)" }}>{i < step ? "✓" : i + 1}</span>
            {s}
          </div>
        ))}
      </div>
    );
  }

  return (
    <form className="card pad" onSubmit={build}>
      <div className="field"><label htmlFor="listing">Listing to promote</label>
        <select id="listing" value={listingId} onChange={(e) => setListingId(e.target.value)}>
          {listings.map((l) => <option key={l.id} value={l.id}>{l.title} · {l.locality} · {inr(l.priceInr, l.purpose === "rent")}</option>)}
        </select>
      </div>

      <div className="field" style={{ marginTop: 12 }}><label>Goal</label>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {GOALS.map((g) => <button type="button" key={g} className={`chip ${goal === g ? "on" : ""}`} aria-pressed={goal === g} onClick={() => setGoal(g)}>{g}</button>)}
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}><label htmlFor="budget">Total budget</label>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {BUDGETS.map((b) => <button type="button" key={b} className={`chip ${budget === b ? "on" : ""}`} aria-pressed={budget === b} onClick={() => setBudget(b)}>{inr(b)}</button>)}
          <input id="budget" type="number" min={5000} step={1000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} style={{ width: 140 }} />
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}><label htmlFor="days">Run for {days} days ({inr(Math.round(budget / Math.max(days, 1)))} a day)</label>
        <input id="days" type="range" min={3} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ accentColor: "#7B3DFF" }} />
      </div>

      <div className="field" style={{ marginTop: 12 }}><label htmlFor="notes">Anything the ads should mention (optional)</label>
        <textarea id="notes" rows={2} maxLength={400} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Festive offer: no floor rise charges till Diwali" />
      </div>

      {error ? <p className="error" style={{ marginTop: 10 }}>{error}</p> : null}
      <button className="btn btn-ai" style={{ width: "100%", height: 48, marginTop: 16, fontSize: 16 }}>✨ Build my campaign</button>
    </form>
  );
}
