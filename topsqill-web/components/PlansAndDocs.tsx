import { imageUrl } from "@/lib/format";
import type { Media } from "@/lib/types";

const PLAN_LABELS = new Set(["Floor plan", "Site plan", "Location map"]);
const ICON: Record<string, string> = { "Floor plan": "📐", "Site plan": "🗺️", "Location map": "📍", "Brochure": "📘", "Price list": "💰" };

/** Plans and maps (floor plan, site plan, location map) and documents (brochure, price list) the owner added. */
export function isPlanOrDoc(m: Media) {
  return m.kind === "document" || m.group === "plan" || PLAN_LABELS.has(m.label ?? "");
}

export function PlansAndDocs({ media, title }: { media: Media[]; title: string }) {
  const items = media.filter((m) => m.urls && Object.keys(m.urls).length && isPlanOrDoc(m));
  if (!items.length) return null;
  const plans = items.filter((m) => m.kind === "image");
  const docs = items.filter((m) => m.kind !== "image");
  return (
    <div className="card pad" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 10 }}>📐 Plans and documents</h2>
      {plans.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
          {plans.map((m) => {
            const full = imageUrl(m, "full") ?? imageUrl(m, "large");
            return (
              <a key={m.id} href={full ?? "#"} target="_blank" rel="noopener noreferrer" style={{ display: "block", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", textDecoration: "none", color: "inherit", background: "#fff" }}>
                <img src={imageUrl(m, "card") ?? full ?? ""} alt={`${m.label ?? "Plan"} of ${title}`} loading="lazy" style={{ width: "100%", aspectRatio: "4/3", objectFit: "contain", display: "block", background: "#fff" }} />
                <div className="spread small" style={{ padding: "8px 12px", borderTop: "1px solid var(--line)", background: "var(--card)" }}>
                  <b>{ICON[m.label ?? ""] ?? "📐"} {m.label ?? "Plan"}</b><span className="muted">View full size ↗</span>
                </div>
              </a>
            );
          })}
        </div>
      ) : null}
      {docs.length ? (
        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: plans.length ? 12 : 0 }}>
          {docs.map((m) => {
            const href = m.urls?.original ?? Object.values(m.urls ?? {})[0];
            return (
              <a key={m.id} href={href} target="_blank" rel="noopener noreferrer" download
                className="row" style={{ gap: 10, border: "1.5px solid var(--line)", borderRadius: 14, padding: "10px 14px", textDecoration: "none", color: "inherit", minWidth: 220 }}>
                <span style={{ fontSize: 26 }} aria-hidden>{ICON[m.label ?? ""] ?? "📄"}</span>
                <span><b className="small">{m.label && !/\.(pdf|jpe?g|png)$/i.test(m.label) ? m.label : "Document"}</b><br /><span className="small muted">PDF · Download</span></span>
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
