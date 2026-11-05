import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ApplyPanel } from "@/components/ApplyPanel";
import { timeAgo } from "@/lib/format";
import type { Job } from "@/lib/types";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const job = await api<Job>(`/v1/jobs/${id}`, { revalidate: 60 }).catch(() => null);
  if (!job) return { title: "Job not found" };
  return {
    title: `${job.title} at ${job.company}`,
    description: job.summary ?? `${job.title} in ${job.city}. ${job.expMin} to ${job.expMax} years of experience.`,
    alternates: { canonical: `/jobs/${id}` },
  };
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user, token] = await Promise.all([params, getUser(), getToken()]);
  const job = await api<Job>(`/v1/jobs/${id}`, { revalidate: 60 }).catch(() => null);
  if (!job) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.summary ?? job.title,
    datePosted: job.createdAt,
    employmentType: job.employment.toUpperCase().replace("-", "_"),
    hiringOrganization: { "@type": "Organization", name: job.company },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.city, addressCountry: "IN" } },
  };

  return (
    <Shell user={user} current="/jobs">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="card pad" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 26 }}>{job.title}</h1>
        <p style={{ margin: "6px 0" }}><b>{job.company}</b> · {job.locality ? `${job.locality}, ` : ""}{job.city}</p>
        <p className="small muted">Posted {timeAgo(job.createdAt)} · {job.applicantCount} applicants</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
          <span className="tag">{job.employment}</span>
          <span className="tag">{job.workMode}</span>
          <span className="tag">{job.expMin}–{job.expMax} yrs</span>
          {job.incentives ? <span className="tag">Incentives</span> : null}
        </div>
        <ApplyPanel jobId={job.id} signedIn={!!user} />
      </div>

      {job.summary ? <div className="card pad" style={{ marginBottom: 16 }}><h2 style={{ fontSize: 19, marginBottom: 8 }}>About the role</h2><p style={{ margin: 0, maxWidth: "72ch" }}>{job.summary}</p></div> : null}

      <div className="card pad" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 19, marginBottom: 8 }}>What you’ll do</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{job.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul>
        <h2 style={{ fontSize: 19, margin: "18px 0 8px" }}>What we’re looking for</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{job.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
        {job.skills.length ? (
          <>
            <h2 style={{ fontSize: 19, margin: "18px 0 8px" }}>Skills</h2>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{job.skills.map((s) => <span key={s} className="tag">{s}</span>)}</div>
          </>
        ) : null}
      </div>

      <Link href="/jobs" className="btn btn-g">← All jobs</Link>
    </Shell>
  );
}
