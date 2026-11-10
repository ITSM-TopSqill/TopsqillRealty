import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { RequirementForm } from "@/components/RequirementForm";
import type { Requirement } from "@/lib/types";

export const metadata = { title: "Edit requirement" };
export const dynamic = "force-dynamic";

export default async function EditRequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user, token] = await Promise.all([params, getUser(), getToken()]);
  if (!user) redirect(`/signin?next=/requirements/${id}/edit`);
  // Only your own requirements can be opened here.
  const mine = await api<{ items: Requirement[] }>("/v1/requirements/mine", { token }).catch(() => ({ items: [] as Requirement[] }));
  const requirement = mine.items.find((r) => r.id === id);
  if (!requirement) notFound();
  return (
    <Shell user={user} current="/requirements">
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Edit requirement</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>Matching listings are found again as soon as you save.</p>
      <RequirementForm defaultCity={user.city ?? "Gurgaon"} defaultLocalities={user.localities ?? []} requirement={requirement} />
    </Shell>
  );
}
