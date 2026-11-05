import Link from "next/link";
import { api } from "@/lib/api";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { Job, Paged } from "@/lib/types";

export const metadata = {
  title: "Real estate jobs",
  description: "Sales, pre-sales, channel partner, marketing and site roles from builders and agencies across India.",
};
export const revalidate = 60;

const CATEGORIES = ["Sales", "Pre-sales", "Channel partners", "Marketing", "Leasing", "Site and engineering", "Operations"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ city?: string; category?: string; search?: string }> }) {
  const [sp, user] = await Promise.all([searchParams, getUser()]);
  const q = new URLSearchParams({ limit: "25" });
  for (const k of ["city", "category", "search"]) if (sp[k as keyof typeof sp]) q.set(k, sp[k as keyof typeof sp]!);
  const jobs = await api<Paged<Job>>(`/v1/jobs?${q}`, { revalidate: 60 }).catch(() => ({ items: [], nextCursor: null }));

  const salary = (j: Job) => {
    if (!j.salaryMin && !j.salaryMax) return "Salary on discussion";
    const fmt = (v?: string | null) => String(Number(v ?? 0)).replace(/\.0$/, "");
    return `₹${fmt(j.salaryMin)}–${fmt(j.salaryMax)} LPA${j.incentives ? " + incentives" : ""}`;
  };

  return (
    <Shell user={user} current="/jobs">
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Real estate jobs</h1>
          <p className="muted small">Openings from builders and agencies. Apply with your Topsqill.ai profile.</p>
        </div>
        {user ? <Link href="/jobs/new" className="btn btn-ai">+ Post a job</Link> : null}
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        <Link href="/jobs" className={`chip ${!sp.category ? "on" : ""}`}>All roles</Link>
        {CATEGORIES.map((c) => (
          <Link key={c} href={`/jobs?category=${encodeURIComponent(c)}`} className={`chip ${sp.category === c ? "on" : ""}`}>{c}</Link>
        ))}
      </div>

      {jobs.items.length ? (
        <div className="col">
          {jobs.items.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card pad" style={{ textDecoration: "none" }}>
              <div className="spread">
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ fontSize: 18, color: "var(--vio)" }}>{j.title}</h2>
                  <div style={{ fontWeight: 700 }}>{j.company}</div>
                  <div className="small muted">
                    📍 {j.locality ? `${j.locality}, ` : ""}{j.city} · {j.workMode} · {j.employment}
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <span className="tag">{salary(j)}</span>
                    <span className="tag">{j.expMin}–{j.expMax} yrs</span>
                    {j.openings > 1 ? <span className="tag">{j.openings} openings</span> : null}
                  </div>
                </div>
                <div className="small muted" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {timeAgo(j.createdAt)}<br />{j.applicantCount} applicants
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : <Empty title="No jobs match this filter" text="Try another role or city." />}
    </Shell>
  );
}
