import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { NewGenericCampaign } from "@/components/NewGenericCampaign";

export const metadata = { title: "New marketing plan" };
export const dynamic = "force-dynamic";

type Business = { id: string; name: string; recommendations: { objectives: string[]; conversionEvents: string[] } };

export default async function NewGenericCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect(`/signin?next=/business/${id}/campaigns/new`);
  const business = await api<Business>(`/v1/business/${id}`, { token }).catch(() => null);
  if (!business) redirect("/business");

  return (
    <Shell user={user} current="/leads">
      <Link href={`/business/${business.id}`} className="small muted">← {business.name}</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>New marketing plan</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        The objective and conversion event choices are matched to {business.name}&apos;s industry.
      </p>
      <NewGenericCampaign businessId={business.id} recs={business.recommendations} />
    </Shell>
  );
}
