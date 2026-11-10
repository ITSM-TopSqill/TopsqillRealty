import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { PublishProject } from "@/components/PublishProject";
import { inr, sqft } from "@/lib/format";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

const getProject = (id: string) => api<Project>(`/v1/ai/projects/${id}`, { revalidate: 60 }).catch(() => null);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await getProject((await params).id);
  if (!p) return { title: "Project" };
  return { title: `${p.name}, ${p.locality}`, description: p.summary ?? undefined, robots: p.published ? undefined : { index: false } };
}

const LEVEL: Record<string, string> = { Low: "#12B76A", Medium: "#E08A00", High: "#E5484D", low: "#12B76A", medium: "#E08A00", high: "#E5484D" };
const USP_COLORS = ["#6A3FE0", "#2F7FE6", "#2E9E90", "#D9668C", "#E08A00", "#12B76A"];

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, user] = await Promise.all([getProject(id), getUser()]);
  const mine = !!user && p?.ownerId === user.id;
  // Drafts are visible only to the member who imported them.
  if (!p || (!p.published && !mine)) notFound();

  const prices = p.configs.map((c) => c.price).filter(Boolean);
  const from = prices.length ? Math.min(...prices) : 0;
  const to = prices.length ? Math.max(...prices) : 0;
  const facts: [string, string | number | null | undefined][] = [
    ["Status", p.status], ["Possession", p.possession], ["Land", p.acres ? `${p.acres} acres` : null],
    ["Towers", p.towers], ["Floors", p.floors], ["Homes", p.units], ["Open area", p.openArea ? `${p.openArea}%` : null],
    ["Payment plan", p.paymentPlan], ["Facing", p.facing.join(", ") || null], ["RERA", p.reraNumber],
  ];

  return (
    <Shell user={user} current="/listings">
      {mine && !p.published ? <PublishProject id={p.id} count={p.configs.length} /> : null}

      <section className="card" style={{ overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        <div style={{ minHeight: 260, background: "linear-gradient(135deg,#1F1D33,#3A2E7A 55%,#2F6FD0)", position: "relative", color: "#fff", padding: 22, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <svg viewBox="0 0 400 220" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: .35 }}>
            {Array.from({ length: Math.min(p.towers ?? 4, 8) }, (_, i) => {
              const w = 34, gap = 12, x = 30 + i * (w + gap), h = 90 + ((i * 37) % 70);
              return <rect key={i} x={x} y={220 - h} width={w} height={h} rx={3} fill="#fff" fillOpacity={0.5 + (i % 3) * 0.15} />;
            })}
          </svg>
          <span className="pill" style={{ position: "relative", alignSelf: "flex-start", background: "rgba(255,255,255,.92)", color: "#1F1D33" }}>{p.status}</span>
          <h1 style={{ position: "relative", fontSize: 32, marginTop: 10 }}>{p.name}</h1>
          <div style={{ position: "relative", opacity: .9 }}>{p.builder ? `by ${p.builder} · ` : ""}{p.locality}, {p.city}</div>
        </div>
        <div className="pad" style={{ padding: 22 }}>
          <div className="small muted" style={{ fontWeight: 700 }}>Price{p.priceEstimated ? " (estimated from the locality rate)" : ""}</div>
          <div style={{ font: '800 30px/1.1 "Bricolage Grotesque",system-ui,sans-serif', background: "var(--brand)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            {from ? (from === to ? inr(from) : `${inr(from)} to ${inr(to)}`) : "Price on request"}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
            {[...new Set(p.configs.map((c) => `${c.bhk} BHK`))].map((b) => <span key={b} className="tag">{b}</span>)}
          </div>
          {p.summary ? <p style={{ margin: "10px 0" }}>{p.summary}</p> : null}
          {p.verdict ? <p className="small" style={{ margin: 0, padding: 12, borderRadius: 12, background: "var(--soft)" }}>✨ <b>Verdict:</b> {p.verdict}</p> : null}
        </div>
      </section>

      {p.usps.length ? (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, margin: "16px 0" }}>
          {p.usps.map((u, i) => (
            <div key={u} className="card row" style={{ gap: 10, padding: 12 }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: USP_COLORS[i % USP_COLORS.length], color: "#fff", display: "grid", placeItems: "center", flex: "none", fontWeight: 800 }}>{i + 1}</span>
              <b className="small">{u}</b>
            </div>
          ))}
        </section>
      ) : null}

      <div className="g2" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16, alignItems: "start", marginTop: 16 }}>
        <div className="col">
          <section className="card pad">
            <h2 style={{ fontSize: 20, marginBottom: 10 }}>Configurations</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead><tr>{["Home", "Super area", "Carpet", "Price", "Per sq ft"].map((h) => <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: "var(--ink3)", borderBottom: "1px solid var(--line)" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {p.configs.map((c, i) => (
                    <tr key={i}>
                      <td style={{ padding: "10px", borderBottom: "1px solid var(--line)", fontWeight: 800 }}>{c.bhk} BHK</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>{sqft(c.sbua)}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>{sqft(c.carpet) || "Not stated"}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid var(--line)", fontWeight: 800 }}>{inr(c.price)}{c.estimated ? "*" : ""}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>{c.price && c.sbua ? `₹${Math.round(c.price / c.sbua).toLocaleString("en-IN")}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {p.priceEstimated ? <p className="small muted" style={{ margin: "8px 0 0" }}>* Estimated from the average rate in {p.locality}. Confirm with the builder.</p> : null}
          </section>

          {p.amenities.length ? (
            <section className="card pad">
              <h2 style={{ fontSize: 20, marginBottom: 10 }}>Amenities</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
                {p.amenities.map((a) => <div key={a} style={{ padding: 12, borderRadius: 12, background: "var(--soft)", fontWeight: 700, fontSize: 13.5 }}>{a}</div>)}
              </div>
            </section>
          ) : null}

          {p.specs.length ? (
            <section className="card pad">
              <h2 style={{ fontSize: 20, marginBottom: 10 }}>Specifications</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{p.specs.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>
          ) : null}
        </div>

        <div className="col">
          <section className="card pad">
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Key facts</h2>
            {facts.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
              <div key={k} className="spread small" style={{ padding: "7px 0", borderTop: "1px solid var(--line)" }}><span className="muted">{k}</span><b>{v}</b></div>
            ))}
          </section>

          {p.risk ? (
            <section className="card pad">
              <div className="spread" style={{ marginBottom: 8 }}>
                <h2 style={{ fontSize: 18 }}>Risk check</h2>
                <span className="pill" style={{ background: `color-mix(in srgb,${LEVEL[p.risk.level] ?? "#8D8AA3"} 16%,transparent)`, color: LEVEL[p.risk.level] }}>{p.risk.level} risk · {p.risk.score}/100</span>
              </div>
              {p.risk.factors.map((f) => (
                <div key={f.label} className="row small" style={{ gap: 8, alignItems: "flex-start", padding: "6px 0" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: LEVEL[f.level] ?? "#8D8AA3", marginTop: 5, flex: "none" }} />
                  <div><b>{f.label}</b><div className="muted">{f.note}</div></div>
                </div>
              ))}
            </section>
          ) : null}

          {p.nearby.length ? (
            <section className="card pad">
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>Nearby</h2>
              {[...p.nearby].sort((a, b) => a.km - b.km).map((n) => (
                <div key={n.name} style={{ display: "grid", gridTemplateColumns: "1fr 90px 50px", gap: 8, alignItems: "center", padding: "5px 0", fontSize: 13 }}>
                  <span>{n.icon ? `${n.icon} ` : ""}{n.name}</span>
                  <i style={{ height: 8, borderRadius: 8, background: "var(--chip)", overflow: "hidden" }}><b style={{ display: "block", height: "100%", width: `${Math.max(8, 100 - n.km * 8)}%`, background: "var(--brand)" }} /></i>
                  <b style={{ textAlign: "right" }}>{n.km} km</b>
                </div>
              ))}
            </section>
          ) : null}

          {p.sourceUrl ? <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="small muted">Source: {new URL(p.sourceUrl).hostname}</a> : null}
          {mine ? <Link href={`/campaigns/new`} className="btn btn-o">Promote with a campaign</Link> : null}
        </div>
      </div>
    </Shell>
  );
}
