import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { JobForm } from "@/components/JobForm";

export const metadata = { title: "Post a job" };
export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/jobs/new");
  return (
    <Shell user={user} current="/jobs">
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Post a job</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>
        Say who you need in one line and AI writes the full post. Check it, change anything, then publish.
      </p>
      <JobForm defaultCity={user.city ?? "Gurgaon"} defaultCompany={user.agency ?? user.name} />
    </Shell>
  );
}
