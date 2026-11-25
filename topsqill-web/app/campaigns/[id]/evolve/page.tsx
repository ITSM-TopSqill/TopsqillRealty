import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { CampaignEvolution } from "@/components/CampaignEvolution";
import type { Campaign } from "@/lib/types";

export const metadata = { title: "AI Campaign Evolution" };
export const dynamic = "force-dynamic";

export default async function CampaignEvolvePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user, token] = await Promise.all([params, getUser(), getToken()]);
  if (!user) redirect(`/signin?next=/campaigns/${id}/evolve`);
  const c = await api<Campaign>(`/v1/campaigns/${id}`, { token }).catch(() => null);
  if (!c) notFound();

  return (
    <Shell user={user} current="/leads">
      <Link href={`/campaigns/${id}`} className="small muted">← {c.name}</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>AI Campaign Evolution</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        Analyses this campaign&apos;s own real spend, leads and creative - no competitor data, since none is connected yet.
        Every proposed change shows its reason, evidence, expected impact, confidence and risk. Nothing changes the live campaign - approved changes become a new draft you review and launch yourself.
      </p>
      <CampaignEvolution campaignId={id} />
    </Shell>
  );
}
