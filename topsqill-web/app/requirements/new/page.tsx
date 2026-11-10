import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { RequirementForm } from "@/components/RequirementForm";

export const metadata = { title: "Post a requirement" };
export const dynamic = "force-dynamic";

export default async function NewRequirementPage() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/requirements/new");
  return (
    <Shell user={user} current="/requirements">
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Post a requirement</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>
        Tell the network what you or your client is looking for. Matching listings are found straight away,
        and dealers with the right property can reach you.
      </p>
      <RequirementForm defaultCity={user.city ?? "Gurgaon"} defaultLocalities={user.localities ?? []} />
    </Shell>
  );
}
