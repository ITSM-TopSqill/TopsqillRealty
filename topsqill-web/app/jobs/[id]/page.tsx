import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ApplyPanel } from "@/components/ApplyPanel";
import { Applicants, type Applicant } from "@/components/Applicants";
import { JobOwnerActions } from "@/components/JobOwnerActions";
import { timeAgo } from "@/lib/format";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";

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
  const open = (job.status ?? "open") === "open";
  const mine = !!user && job.ownerId === user.id;
  const applicants = mine
    ? await api<{ items: Applicant[] }>(`/v1/jobs/${id}/applicants`, { token }).catch(() => ({ items: [] as Applicant[] }))
    : null;

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
        {!open ? <span className="tag" style={{ marginBottom: 8, display: "inline-block" }}>Closed</span> : null}
        <h1 style={{ fontSize: 26 }}>{job.title}</h1>
        <p style={{ margin: "6px 0" }}><b>{job.company}</b> · {job.locality ? `${job.locality}, ` : ""}{job.city}</p>
        <p className="small muted">Posted {timeAgo(job.createdAt)} · {job.applicantCount} applicants</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
          <span className="tag">{job.employment}</span>
          <span className="tag">{job.workMode}</span>
          <span className="tag">{job.expMin}–{job.expMax} yrs</span>
          {job.incentives ? <span className="tag">Incentives</span> : null}
        </div>
        {mine
          ? <JobOwnerActions id={job.id} open={open} />
          : open ? <ApplyPanel jobId={job.id} signedIn={!!user} /> : <p className="small muted" style={{ margin: 0 }}>This job is closed and no longer taking applications.</p>}
      </div>

      {applicants ? <Applicants items={applicants.items} /> : null}

      {job.summary ? <div className="card pad" style={{ marginBottom: 16 }}><h2 style={{ fontSize: 19, marginBottom: 8 }}>About the role</h2><p style={{ margin: 0, maxWidth: "72ch" }}>{job.summary}</p></div> : null}

      {job.responsibilities.length || job.requirements.length || job.skills.length ? (
        <div className="card pad" style={{ marginBottom: 16 }}>
          {job.responsibilities.length ? (
            <>
              <h2 style={{ fontSize: 19, marginBottom: 8 }}>What you’ll do</h2>
              <ul style={{ margin: "0 0 18px", paddingLeft: 20 }}>{job.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul>
            </>
          ) : null}
          {job.requirements.length ? (
            <>
              <h2 style={{ fontSize: 19, marginBottom: 8 }}>What we’re looking for</h2>
              <ul style={{ margin: "0 0 18px", paddingLeft: 20 }}>{job.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
            </>
          ) : null}
          {job.skills.length ? (
            <>
              <h2 style={{ fontSize: 19, marginBottom: 8 }}>Skills</h2>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{job.skills.map((s) => <span key={s} className="tag">{s}</span>)}</div>
            </>
          ) : null}
        </div>
      ) : null}

      <Link href="/jobs" className="btn btn-g">← All jobs</Link>
    </Shell>
  );
}
