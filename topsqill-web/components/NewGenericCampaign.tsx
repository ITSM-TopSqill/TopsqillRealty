"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

type Recs = { objectives: string[]; conversionEvents: string[] };

/**
 * Universal Campaign Objectives/Conversion Engine (Sections 5-6): a draft
 * marketing plan limited to the objectives and conversion events the
 * business's own industry supports. Saves as a draft only - see the
 * business detail page for why this doesn't launch to a channel yet.
 */
export function NewGenericCampaign({ businessId, recs }: { businessId: string; recs: Recs }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState(recs.objectives[0] ?? "");
  const [conversionEvent, setConversionEvent] = useState(recs.conversionEvents[0] ?? "");
  const [budgetInr, setBudgetInr] = useState(10000);
  const [days, setDays] = useState(15);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    if (!name.trim()) { setError("Give the plan a name."); return; }
    setBusy(true);
    try {
      await clientApi("/v1/business/campaigns", { method: "POST", body: { businessId, name, objective, conversionEvent, budgetInr, days, notes } });
      router.push(`/business/${businessId}`);
      router.refresh();
    } catch (e) { setError((e as Error).message || "Something went wrong."); }
    finally { setBusy(false); }
  }

  return (
    <div className="card pad">
      {error ? <p className="error small" style={{ marginBottom: 8 }}>{error}</p> : null}
      <div className="col" style={{ gap: 10 }}>
        <div>
          <label className="small muted">Plan name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="e.g. Festive season push" />
        </div>
        <div>
          <label className="small muted">Objective</label>
          <select value={objective} onChange={(e) => setObjective(e.target.value)}>
            {recs.objectives.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="small muted">Conversion event to track</label>
          <select value={conversionEvent} onChange={(e) => setConversionEvent(e.target.value)}>
            {recs.conversionEvents.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="small muted">Budget (₹)</label>
            <input type="number" min={1} value={budgetInr} onChange={(e) => setBudgetInr(Number(e.target.value))} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="small muted">Days</label>
            <input type="number" min={3} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </div>
        </div>
        <div>
          <label className="small muted">Notes (optional)</label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={400} />
        </div>
      </div>
      <button type="button" className="btn btn-ai" disabled={busy} style={{ marginTop: 14 }} onClick={save}>{busy ? "Saving…" : "Save draft plan"}</button>
      <p className="small muted" style={{ marginTop: 8 }}>This saves a draft plan only - it isn&apos;t launched to Meta, Google or any other channel yet.</p>
    </div>
  );
}
