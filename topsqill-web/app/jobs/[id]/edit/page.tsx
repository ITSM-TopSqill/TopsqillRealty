import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { JobForm } from "@/components/JobForm";
import type { Job } from "@/lib/types";

export const metadata = { title: "Edit job post" };
export const dynamic = "force-dynamic";

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, getUser()]);
  if (!user) redirect(`/signin?next=/jobs/${id}/edit`);
  const job = await api<Job>(`/v1/jobs/${id}`).catch(() => null);
  // Only the person who posted it can edit it (the API checks this too).
  if (!job || job.ownerId !== user.id) notFound();
  return (
    <Shell user={user} current="/jobs">
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Edit job post</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>Changes show on the job page straight away. People who already applied keep their applications.</p>
      <JobForm defaultCity={job.city} defaultCompany={job.company} job={job} />
    </Shell>
  );
}
