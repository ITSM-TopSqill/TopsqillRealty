"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import type { Differentiator } from "@/lib/types";

type Row = { differentiatorId: string; operator: string; value: string };
type Draft = { conditions: { differentiatorId: string; operator: string; value: unknown }[]; explanation: string; unavailableRequest: string | null };

const OP_LABEL: Record<string, string> = { eq: "is", neq: "is not", gte: "at least", lte: "at most", in: "is one of", not_in: "is not one of", contains: "contains" };

function emptyRow(differentiators: Differentiator[]): Row {
  const first = differentiators[0];
  return { differentiatorId: first?.id ?? "", operator: first?.operators[0] ?? "eq", value: "" };
}

function coerceValue(d: Differentiator | undefined, operator: string, raw: string): unknown {
  if (!d) return raw;
  if (operator === "in" || operator === "not_in") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (d.valueType === "number") return Number(raw);
  if (d.valueType === "boolean") return raw === "true";
  return raw;
}

/**
 * Universal Audience Builder (Part 5), scoped honestly: AND/OR + NOT over
 * real CRM fields, with one include group and one exclude group (full
 * recursive nested-group UI isn't built - the backend model supports it,
 * see differentiators.ts). Describes-from-text uses AI when available and
 * is reviewed before saving; never silently writes a segment.
 */
export function SegmentBuilder({ differentiators }: { differentiators: Differentiator[] }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [includeMatch, setIncludeMatch] = useState<"all" | "any">("all");
  const [includeRows, setIncludeRows] = useState<Row[]>([emptyRow(differentiators)]);
  const [excludeRows, setExcludeRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function byId(id: string) { return differentiators.find((d) => d.id === id); }

  async function draft() {
    if (!description.trim()) return;
    setDrafting(true); setError(""); setUnavailable(null);
    try {
      const d = await clientApi<Draft>("/v1/customer-intelligence/segments/describe", { method: "POST", body: { description } });
      if (d.conditions.length) {
        setIncludeRows(d.conditions.map((c) => ({ differentiatorId: c.differentiatorId, operator: c.operator, value: Array.isArray(c.value) ? c.value.join(", ") : String(c.value) })));
        setName(description.slice(0, 60));
      }
      setUnavailable(d.unavailableRequest);
    } catch (e) { setError((e as Error).message || "Couldn't read that."); }
    finally { setDrafting(false); }
  }

  function updateRow(rows: Row[], setRows: (r: Row[]) => void, i: number, patch: Partial<Row>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setError("");
    if (!name.trim()) { setError("Give the segment a name."); return; }
    setSaving(true);
    try {
      const definition = {
        include: { kind: "group", match: includeMatch, conditions: includeRows.filter((r) => r.differentiatorId).map((r) => ({ kind: "condition", differentiatorId: r.differentiatorId, operator: r.operator, value: coerceValue(byId(r.differentiatorId), r.operator, r.value) })) },
        ...(excludeRows.length ? { exclude: { kind: "group", match: "any", conditions: excludeRows.filter((r) => r.differentiatorId).map((r) => ({ kind: "condition", differentiatorId: r.differentiatorId, operator: r.operator, value: coerceValue(byId(r.differentiatorId), r.operator, r.value) })) } } : {}),
      };
      await clientApi("/v1/customer-intelligence/segments", { method: "POST", body: { name, definition, source: "manual" } });
      router.refresh();
      setIncludeRows([emptyRow(differentiators)]); setExcludeRows([]); setName(""); setDescription(""); setUnavailable(null);
    } catch (e) { setError((e as Error).message || "Something went wrong."); }
    finally { setSaving(false); }
  }

  function ConditionRow({ row, onChange, onRemove }: { row: Row; onChange: (p: Partial<Row>) => void; onRemove: () => void }) {
    const d = byId(row.differentiatorId);
    return (
      <div className="condition-row">
        <select className="condition-field" value={row.differentiatorId} onChange={(e) => { const nd = byId(e.target.value); onChange({ differentiatorId: e.target.value, operator: nd?.operators[0] ?? "eq" }); }}>
          {differentiators.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="condition-op-value">
          <select value={row.operator} onChange={(e) => onChange({ operator: e.target.value })}>
            {(d?.operators ?? []).map((op) => <option key={op} value={op}>{OP_LABEL[op] ?? op}</option>)}
          </select>
          {d?.valueType === "boolean" ? (
            <select value={row.value} onChange={(e) => onChange({ value: e.target.value })}>
              <option value="">Pick…</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : d?.enumValues ? (
            <select value={row.value} onChange={(e) => onChange({ value: e.target.value })}>
              <option value="">Pick…</option>
              {d.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ) : (
            <input value={row.value} onChange={(e) => onChange({ value: e.target.value })} placeholder={d?.valueType === "number" ? "e.g. 70" : "value"} />
          )}
          <button type="button" className="linklike small" onClick={onRemove}>Remove</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card pad">
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="seg-describe">Describe the customer you want (optional - AI prefills the builder below)</label>
        <textarea id="seg-describe" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={800}
          placeholder="e.g. Qualified buyers with a budget over 50 lakh who haven't gone cold" />
      </div>
      <button type="button" className="btn btn-o" disabled={drafting || !description.trim()} onClick={draft} style={{ marginBottom: 12 }}>{drafting ? "Reading…" : "Let AI draft this"}</button>
      {unavailable ? <p className="small muted" style={{ marginBottom: 12 }}>Couldn&apos;t fully match that: {unavailable}</p> : null}
      {error ? <p className="error small" style={{ marginBottom: 8 }}>{error}</p> : null}

      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="seg-name">Segment name</label>
        <input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
      </div>

      <b className="small">Include leads where</b>
      <div className="row" style={{ gap: 8, margin: "6px 0" }}>
        <button type="button" className={`chip ${includeMatch === "all" ? "on" : ""}`} onClick={() => setIncludeMatch("all")}>ALL match (AND)</button>
        <button type="button" className={`chip ${includeMatch === "any" ? "on" : ""}`} onClick={() => setIncludeMatch("any")}>ANY match (OR)</button>
      </div>
      {includeRows.map((row, i) => (
        <ConditionRow key={i} row={row} onChange={(p) => updateRow(includeRows, setIncludeRows, i, p)} onRemove={() => setIncludeRows(includeRows.filter((_, idx) => idx !== i))} />
      ))}
      <button type="button" className="linklike small" onClick={() => setIncludeRows([...includeRows, emptyRow(differentiators)])}>+ Add condition</button>

      <b className="small" style={{ display: "block", marginTop: 16 }}>Exclude leads where ANY match</b>
      {excludeRows.map((row, i) => (
        <ConditionRow key={i} row={row} onChange={(p) => updateRow(excludeRows, setExcludeRows, i, p)} onRemove={() => setExcludeRows(excludeRows.filter((_, idx) => idx !== i))} />
      ))}
      <button type="button" className="linklike small" onClick={() => setExcludeRows([...excludeRows, emptyRow(differentiators)])}>+ Add exclusion</button>

      <div style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-ai" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save segment"}</button>
      </div>
    </div>
  );
}
