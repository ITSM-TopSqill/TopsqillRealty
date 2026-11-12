import { vastuFrom } from "@/lib/vastu";

/** Vastu indicator from the listing's facing direction (only shown when the facing is a direction). */
export function VastuScore({ facing }: { facing?: string | null }) {
  const v = vastuFrom(facing);
  if (!v) return null;
  return (
    <div className="card pad" style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ textAlign: "center", minWidth: 96 }}>
        <div style={{ font: '800 34px/1 "Bricolage Grotesque", system-ui, sans-serif' }}>{v.score}<span className="small muted">/100</span></div>
        <div className="small" style={{ fontWeight: 700, marginTop: 4 }}>{v.verdict}</div>
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>🧭 Vastu indicator · {v.direction} facing</h2>
        {v.notes.map((n) => <p key={n} className="small" style={{ margin: "2px 0" }}>{n}</p>)}
        <p className="small muted" style={{ margin: "6px 0 0" }}>A guide from the facing direction only, not a full Vastu assessment.</p>
      </div>
    </div>
  );
}
