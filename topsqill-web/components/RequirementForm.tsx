"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { inr } from "@/lib/format";
import { CITIES, KINDS } from "@/lib/options";
import { refreshPages } from "@/lib/refresh";
import type { Requirement } from "@/lib/types";

const TIMELINES = ["Immediately", "Within 1 month", "1 to 3 months", "3 to 6 months", "Just exploring"];

/** "3 BHK in Sector 150 under 1.8 Cr" becomes a requirement that dealers can match. */
export function RequirementForm({ defaultCity, defaultLocalities, requirement }: {
  defaultCity: string; defaultLocalities: string[];
  /** Given, the form edits this requirement instead of posting a new one. */
  requirement?: Requirement;
}) {
  const router = useRouter();
  const r = requirement;
  const num = (v?: number | null) => (v != null ? String(v) : "");
  const [f, setF] = useState(r ? {
    purpose: r.purpose, kind: r.kind, bhk: num(r.bhk), city: r.city,
    localities: r.localities.join(", "), minPrice: num(r.minPrice), maxPrice: num(r.maxPrice), minArea: num(r.minArea),
    timeline: r.timeline ?? "1 to 3 months", needsLoan: !!r.needsLoan, note: r.note ?? "",
  } : {
    purpose: "sale" as "sale" | "rent", kind: "Apartment", bhk: "3", city: defaultCity,
    localities: defaultLocalities.join(", "), minPrice: "", maxPrice: "", minArea: "",
    timeline: "1 to 3 months", needsLoan: false, note: "",
  });
  const cities = CITIES.includes(f.city) ? CITIES : [f.city, ...CITIES];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const rent = f.purpose === "rent";
  const money = (v: string) => (Number(v) ? inr(Number(v), rent) : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const localities = f.localities.split(",").map((s) => s.trim()).filter(Boolean);
    if (!localities.length) { setError("Add at least one locality."); return; }
    if (Number(f.minPrice) && Number(f.maxPrice) && Number(f.minPrice) > Number(f.maxPrice)) {
      setError("The minimum budget is higher than the maximum."); return;
    }
    setBusy(true); setError("");
    try {
      // When editing, an emptied field is sent as null so it is cleared.
      const none = r ? null : undefined;
      const body = {
        purpose: f.purpose, kind: f.kind, city: f.city, localities,
        bhk: Number(f.bhk) || none,
        minPrice: Number(f.minPrice) || none, maxPrice: Number(f.maxPrice) || none,
        minArea: Number(f.minArea) || none, timeline: f.timeline, needsLoan: f.needsLoan,
        note: f.note.trim() || none,
      };
      if (r) {
        await clientApi(`/v1/requirements/${r.id}`, { method: "PATCH", body });
        await refreshPages(["/requirements"]);
      } else {
        await clientApi("/v1/requirements", { method: "POST", body });
      }
      router.push("/requirements");
      router.refresh();
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <form className="card pad" onSubmit={submit}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        <div className="field"><label htmlFor="purpose">Looking to</label>
          <select id="purpose" value={f.purpose} onChange={set("purpose")}><option value="sale">Buy</option><option value="rent">Rent</option></select>
        </div>
        <div className="field"><label htmlFor="kind">Property type</label>
          <select id="kind" value={f.kind} onChange={set("kind")}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="bhk">Bedrooms</label>
          <select id="bhk" value={f.bhk} onChange={set("bhk")}>
            <option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} BHK</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="city">City</label>
          <select id="city" value={f.city} onChange={set("city")}>{cities.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="localities">Localities (comma separated)</label>
          <input id="localities" value={f.localities} onChange={set("localities")} placeholder="Sector 150, Sector 128" />
        </div>
        <div className="field"><label htmlFor="min">{rent ? "Minimum rent (₹/month)" : "Minimum budget (₹)"}</label>
          <input id="min" type="number" min={0} value={f.minPrice} onChange={set("minPrice")} placeholder={rent ? "40000" : "12000000"} />
          <small className="muted">{money(f.minPrice)}</small>
        </div>
        <div className="field"><label htmlFor="max">{rent ? "Maximum rent (₹/month)" : "Maximum budget (₹)"}</label>
          <input id="max" type="number" min={0} value={f.maxPrice} onChange={set("maxPrice")} placeholder={rent ? "60000" : "18000000"} />
          <small className="muted">{money(f.maxPrice)}</small>
        </div>
        <div className="field"><label htmlFor="area">Minimum area (sq ft)</label>
          <input id="area" type="number" min={0} value={f.minArea} onChange={set("minArea")} placeholder="1400" />
        </div>
        <div className="field"><label htmlFor="timeline">When</label>
          <select id="timeline" value={f.timeline} onChange={set("timeline")}>{TIMELINES.map((t) => <option key={t}>{t}</option>)}</select>
        </div>
        <label className="row" style={{ gridColumn: "1 / -1", gap: 8, fontWeight: 700 }}>
          <input type="checkbox" checked={f.needsLoan} onChange={set("needsLoan")} /> Needs a home loan
        </label>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="note">Anything else</label>
          <textarea id="note" rows={3} value={f.note} onChange={set("note")} maxLength={1000}
            placeholder="East facing, high floor, close to the metro. Client is ready to close this month." />
        </div>
      </div>
      {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        {r ? <button type="button" className="btn btn-g" onClick={() => router.push("/requirements")}>Cancel</button> : null}
        <button className="btn btn-ai" disabled={busy}>{busy ? (r ? "Saving…" : "Posting…") : r ? "Save changes" : "Post requirement"}</button>
      </div>
    </form>
  );
}
