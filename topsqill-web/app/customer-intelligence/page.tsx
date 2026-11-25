import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { SegmentBuilder } from "@/components/SegmentBuilder";
import type { Differentiator } from "@/lib/types";

export const metadata = { title: "Customer Intelligence" };
export const dynamic = "force-dynamic";

type Segment = { id: string; name: string; source: "manual" | "ai"; preview: { totalLeadsConsidered: number; matchedCount: number; sample: { id: string; name: string; stage: string; score: number; qualified: boolean }[] } };

export default async function CustomerIntelligencePage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin?next=/customer-intelligence");

  const [differentiators, segments] = await Promise.all([
    api<Differentiator[]>("/v1/customer-intelligence/differentiators", { token }).catch(() => [] as Differentiator[]),
    api<{ items: { id: string; name: string; source: "manual" | "ai" }[] }>("/v1/customer-intelligence/segments", { token }).catch(() => ({ items: [] })),
  ]);
  const withPreview: Segment[] = await Promise.all(
    segments.items.map(async (s) => {
      const full = await api<Segment>(`/v1/customer-intelligence/segments/${s.id}`, { token }).catch(() => null);
      return full ?? { id: s.id, name: s.name, source: s.source, preview: { totalLeadsConsidered: 0, matchedCount: 0, sample: [] } };
    }),
  );

  return (
    <Shell user={user} current="/leads">
      <Link href="/leads" className="small muted">← Leads</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>Customer Intelligence</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        Build CRM segments from your real leads - stage, score, source, locality, budget, recency. Every segment is matched live against your actual data, nothing invented.
        These are CRM segments only - Topsqill doesn&apos;t yet push custom audiences to Meta or Google.
      </p>

      <SegmentBuilder differentiators={differentiators} />

      <h2 style={{ fontSize: 20, margin: "24px 0 10px" }}>Saved segments</h2>
      {withPreview.length ? (
        <div className="col" style={{ gap: 10 }}>
          {withPreview.map((s) => (
            <div key={s.id} className="card pad">
              <div className="spread">
                <b>{s.name}</b>
                <span className="pill">{s.source === "ai" ? "AI-drafted" : "manual"}</span>
              </div>
              <p className="small muted" style={{ marginTop: 4 }}>
                {s.preview.matchedCount} of {s.preview.totalLeadsConsidered} leads match
                {s.preview.sample.length ? `: ${s.preview.sample.map((l) => l.name).join(", ")}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No segments yet" text="Describe the customer you want above, or build one directly from the differentiator catalog." />
      )}

      <h2 style={{ fontSize: 20, margin: "24px 0 10px" }}>Differentiator catalog</h2>
      <p className="small muted" style={{ marginBottom: 10, maxWidth: "70ch" }}>
        Every real signal a segment can be built from, and what it actually is - no bank, wealth or health data, since Topsqill doesn&apos;t have any.
      </p>
      <div className="col" style={{ gap: 8 }}>
        {differentiators.map((d) => (
          <div key={d.id} className="card pad">
            <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
              <b>{d.name}</b>
              <span className="small muted">{d.category} · {d.reliability} reliability</span>
            </div>
            <p className="small" style={{ marginTop: 4 }}>{d.description}</p>
            <p className="small muted" style={{ marginTop: 2 }}>Source: {d.source}. {d.restrictions}</p>
          </div>
        ))}
      </div>
    </Shell>
  );
}
