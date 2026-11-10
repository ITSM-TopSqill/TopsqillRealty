"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { CITIES, JOB_CATEGORIES } from "@/lib/options";
import { refreshPages } from "@/lib/refresh";
import type { Job } from "@/lib/types";

type Draft = {
  title: string; category: string; employment: string; workMode: string; openings: number;
  expMin: number; expMax: number; salaryMin: number; salaryMax: number; incentives: boolean;
  skills: string[]; summary: string; responsibilities: string[]; requirements: string[];
};

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** One line in, a complete job post out, editable before it goes live. */
export function JobForm({ defaultCity, defaultCompany, job }: {
  defaultCity: string; defaultCompany: string;
  /** Given, the form edits this job post instead of writing a new one. */
  job?: Job;
}) {
  const router = useRouter();
  const [request, setRequest] = useState("");
  const [company, setCompany] = useState(job?.company ?? defaultCompany);
  const [city, setCity] = useState(job?.city ?? defaultCity);
  const [locality, setLocality] = useState(job?.locality ?? "");
  const [d, setD] = useState<Draft | null>(job ? {
    title: job.title, category: job.category, employment: job.employment, workMode: job.workMode, openings: job.openings,
    expMin: job.expMin, expMax: job.expMax, salaryMin: Number(job.salaryMin) || 0, salaryMax: Number(job.salaryMax) || 0,
    incentives: job.incentives, skills: job.skills, summary: job.summary ?? "", responsibilities: job.responsibilities, requirements: job.requirements,
  } : null);
  const [text, setText] = useState(job
    ? { skills: job.skills.join(", "), responsibilities: job.responsibilities.join("\n"), requirements: job.requirements.join("\n") }
    : { skills: "", responsibilities: "", requirements: "" });
  const cities = CITIES.includes(city) ? CITIES : [city, ...CITIES];
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [error, setError] = useState("");

  async function draft() {
    if (request.trim().length < 6) { setError("Describe the role in a line first."); return; }
    setBusy("ai"); setError("");
    try {
      // "source" says whether AI or the built-in rules wrote it; it is not part of the job.
      const { source: _source, ...res } = await clientApi<Draft & { source?: string }>("/v1/jobs/draft", { method: "POST", body: { request, company, city } });
      setD(res);
      setText({ skills: res.skills.join(", "), responsibilities: res.responsibilities.join("\n"), requirements: res.requirements.join("\n") });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  const upd = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));

  async function publish() {
    if (!d) return;
    if (!d.title.trim()) { setError("Add a job title."); return; }
    setBusy("save"); setError("");
    try {
      const none = job ? null : undefined;
      const body = {
        ...d, company, city, locality: locality || none,
        openings: Number(d.openings) || 1, expMin: Number(d.expMin) || 0, expMax: Number(d.expMax) || 0,
        salaryMin: Number(d.salaryMin) || none, salaryMax: Number(d.salaryMax) || none,
        skills: text.skills.split(",").map((s) => s.trim()).filter(Boolean),
        responsibilities: lines(text.responsibilities), requirements: lines(text.requirements),
      };
      if (job) {
        await clientApi(`/v1/jobs/${job.id}`, { method: "PATCH", body });
        await refreshPages([`/jobs/${job.id}`, "/jobs"]);
        router.push(`/jobs/${job.id}`);
        router.refresh();
        return;
      }
      const created = await clientApi<{ id: string }>("/v1/jobs", { method: "POST", body });
      router.push(`/jobs/${created.id}`);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }

  return (
    <div className="col">
      <div className="card pad" style={job ? undefined : { border: "2px solid var(--vio)" }}>
        {job ? <h2 style={{ fontSize: 17, marginBottom: 4 }}>Company and location</h2> : (
          <>
            <h2 style={{ fontSize: 17, marginBottom: 4 }}>✨ Who are you hiring?</h2>
            <p className="small muted" style={{ marginBottom: 10 }}>
              For example: “Need 2 sales managers with 4+ years in luxury residential, 8 to 12 LPA plus incentives”.
            </p>
            <textarea rows={2} value={request} onChange={(e) => setRequest(e.target.value)} maxLength={600}
              style={{ width: "100%", border: "1.5px solid var(--line)", borderRadius: 12, padding: 10, background: "var(--card)" }} />
          </>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginTop: 10 }}>
          <div className="field"><label htmlFor="company">Company</label>
            <input id="company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="field"><label htmlFor="city">City</label>
            <select id="city" value={city} onChange={(e) => setCity(e.target.value)}>{cities.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="field"><label htmlFor="locality">Office locality</label>
            <input id="locality" value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="Golf Course Road" />
          </div>
        </div>
        {job ? null : (
          <button className="btn btn-ai sm" style={{ marginTop: 12 }} onClick={draft} disabled={busy !== null}>
            {busy === "ai" ? "Writing…" : d ? "Write it again" : "Write the job post"}
          </button>
        )}
        {!d && error ? <p className="error" style={{ marginTop: 10 }}>{error}</p> : null}
      </div>

      {d ? (
        <div className="card pad">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="title">Job title</label>
              <input id="title" value={d.title} onChange={(e) => upd("title", e.target.value)} maxLength={120} />
            </div>
            <div className="field"><label htmlFor="cat">Category</label>
              <select id="cat" value={d.category} onChange={(e) => upd("category", e.target.value)}>
                {JOB_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="emp">Employment</label>
              <select id="emp" value={d.employment} onChange={(e) => upd("employment", e.target.value)}>
                {["Full-time", "Part-time", "Contract", "Internship"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="mode">Work mode</label>
              <select id="mode" value={d.workMode} onChange={(e) => upd("workMode", e.target.value)}>
                {["On-site", "Field", "Hybrid"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="open">Openings</label>
              <input id="open" type="number" min={1} value={d.openings} onChange={(e) => upd("openings", Number(e.target.value))} />
            </div>
            <div className="field"><label htmlFor="emin">Experience from (years)</label>
              <input id="emin" type="number" min={0} value={d.expMin} onChange={(e) => upd("expMin", Number(e.target.value))} />
            </div>
            <div className="field"><label htmlFor="emax">Experience to (years)</label>
              <input id="emax" type="number" min={0} value={d.expMax} onChange={(e) => upd("expMax", Number(e.target.value))} />
            </div>
            <div className="field"><label htmlFor="smin">Salary from (LPA)</label>
              <input id="smin" type="number" min={0} step="0.5" value={d.salaryMin} onChange={(e) => upd("salaryMin", Number(e.target.value))} />
            </div>
            <div className="field"><label htmlFor="smax">Salary to (LPA)</label>
              <input id="smax" type="number" min={0} step="0.5" value={d.salaryMax} onChange={(e) => upd("salaryMax", Number(e.target.value))} />
            </div>
            <label className="row" style={{ gridColumn: "1 / -1", gap: 8, fontWeight: 700 }}>
              <input type="checkbox" checked={d.incentives} onChange={(e) => upd("incentives", e.target.checked)} /> Incentives on top of salary
            </label>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="sum">About the role</label>
              <textarea id="sum" rows={3} value={d.summary} onChange={(e) => upd("summary", e.target.value)} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="skills">Skills (comma separated)</label>
              <input id="skills" value={text.skills} onChange={(e) => setText((t) => ({ ...t, skills: e.target.value }))} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="resp">What they will do, one per line</label>
              <textarea id="resp" rows={4} value={text.responsibilities} onChange={(e) => setText((t) => ({ ...t, responsibilities: e.target.value }))} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="req">What you need, one per line</label>
              <textarea id="req" rows={4} value={text.requirements} onChange={(e) => setText((t) => ({ ...t, requirements: e.target.value }))} />
            </div>
          </div>
          {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            {job ? <button className="btn btn-g" onClick={() => router.push(`/jobs/${job.id}`)}>Cancel</button> : null}
            <button className="btn btn-ai" onClick={publish} disabled={busy !== null}>
              {busy === "save" ? (job ? "Saving…" : "Publishing…") : job ? "Save changes" : "Publish job"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
