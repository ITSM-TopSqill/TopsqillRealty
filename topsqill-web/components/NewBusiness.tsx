"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

type Industry = { id: string; label: string; sector: string };
type Draft = {
  name: string; industryId: string; businessModel?: string; description?: string; products?: string;
  targetSegments?: string; geographicMarkets?: string; acquisitionGoals?: string;
  industryGuess: { id: string; label: string; confidence: "low" | "medium" | "high" };
};

const SECTOR_LABEL: Record<string, string> = {
  property: "Property & infrastructure", ecommerce: "E-commerce & retail", education: "Education & training",
  healthcare: "Healthcare & wellness", finance: "Financial services", automotive: "Automotive & transportation",
  hospitality: "Hospitality, food & travel", technology: "Technology & digital services", b2b: "B2B & professional services",
  entertainment: "Entertainment & lifestyle", home_services: "Home & local services", other: "Other",
};

/**
 * AI Business Discovery Engine (Section 3): describe the business in plain
 * words, review the AI's industry guess and extracted fields, edit anything,
 * then save. Nothing is written until the member submits the reviewed form.
 */
export function NewBusiness() {
  const router = useRouter();
  const [groups, setGroups] = useState<{ sector: string; industries: Industry[] }[]>([]);
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Draft>({ name: "", industryId: "", industryGuess: { id: "", label: "", confidence: "low" } });
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    clientApi<{ sector: string; industries: Industry[] }[]>("/v1/business/industries").then(setGroups).catch(() => setGroups([]));
  }, []);

  async function draft() {
    if (!description.trim()) return;
    setError(""); setDrafting(true);
    try {
      const d = await clientApi<Draft>("/v1/business/describe", { method: "POST", body: { description } });
      setForm(d);
      setReviewing(true);
    } catch (e) { setError((e as Error).message || "Couldn't read that. Try rephrasing."); }
    finally { setDrafting(false); }
  }

  async function save() {
    setError("");
    if (!form.name.trim()) { setError("Give the business a name."); return; }
    if (!form.industryId) { setError("Pick an industry."); return; }
    setSaving(true);
    try {
      const b = await clientApi<{ id: string }>("/v1/business", { method: "POST", body: form });
      router.push(`/business/${b.id}`);
    } catch (e) { setError((e as Error).message || "Something went wrong."); }
    finally { setSaving(false); }
  }

  if (!reviewing) {
    return (
      <div className="card pad">
        <label className="small muted" style={{ display: "block", marginBottom: 6 }}>Describe the business in a sentence or two</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1500}
          placeholder="e.g. We manufacture premium modular furniture and want orders from homeowners, architects and interior designers." />
        {error ? <p className="error small" style={{ marginTop: 8 }}>{error}</p> : null}
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button type="button" className="btn btn-ai" disabled={drafting || !description.trim()} onClick={draft}>{drafting ? "Reading…" : "Let AI read it"}</button>
          <button type="button" className="btn btn-o" onClick={() => { setForm({ name: "", industryId: "other", industryGuess: { id: "other", label: "Other / not listed", confidence: "low" } }); setReviewing(true); }}>
            Fill it in myself
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card pad">
      {form.industryGuess.id ? (
        <p className="small muted" style={{ marginBottom: 12 }}>
          AI read this as <b>{form.industryGuess.label}</b> ({form.industryGuess.confidence} confidence). Review and fix anything below before saving.
        </p>
      ) : null}
      {error ? <p className="error small" style={{ marginBottom: 8 }}>{error}</p> : null}

      <div className="col" style={{ gap: 10 }}>
        <div>
          <label className="small muted">Business name</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={160} />
        </div>
        <div>
          <label className="small muted">Industry</label>
          <select value={form.industryId} onChange={(e) => setForm((f) => ({ ...f, industryId: e.target.value }))}>
            <option value="">Pick one…</option>
            {groups.map((g) => (
              <optgroup key={g.sector} label={SECTOR_LABEL[g.sector] ?? g.sector}>
                {g.industries.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="small muted">What you sell / offer</label>
          <textarea rows={2} value={form.products ?? ""} onChange={(e) => setForm((f) => ({ ...f, products: e.target.value }))} maxLength={2000} />
        </div>
        <div>
          <label className="small muted">Who you're targeting</label>
          <textarea rows={2} value={form.targetSegments ?? ""} onChange={(e) => setForm((f) => ({ ...f, targetSegments: e.target.value }))} maxLength={1000} />
        </div>
        <div>
          <label className="small muted">Where (geography)</label>
          <input value={form.geographicMarkets ?? ""} onChange={(e) => setForm((f) => ({ ...f, geographicMarkets: e.target.value }))} maxLength={500} />
        </div>
        <div>
          <label className="small muted">Customer acquisition goal</label>
          <input value={form.acquisitionGoals ?? ""} onChange={(e) => setForm((f) => ({ ...f, acquisitionGoals: e.target.value }))} maxLength={1000} />
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <button type="button" className="btn btn-ai" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save business"}</button>
        <button type="button" className="btn btn-o" onClick={() => setReviewing(false)}>Back</button>
      </div>
    </div>
  );
}
