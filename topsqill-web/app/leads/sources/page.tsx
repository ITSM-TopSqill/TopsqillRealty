import Link from "next/link";
import { redirect } from "next/navigation";
import { api, API_URL } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { LeadSources, type Source } from "@/components/LeadSources";

export const metadata = { title: "Lead sources" };
export const dynamic = "force-dynamic";

export default async function LeadSourcesPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin?next=/leads/sources");
  const { items } = await api<{ items: Source[] }>("/v1/lead-sources", { token }).catch(() => ({ items: [] as Source[] }));

  return (
    <Shell user={user} current="/leads">
      <Link href="/leads" className="small muted">← Leads</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>Lead sources</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        Connect your ads, portals, website and call tracking. Each source gets its own private link; every
        enquiry sent to it lands on your lead board within seconds, scored and with duplicates merged.
      </p>
      <LeadSources initial={items} apiBase={API_URL} />
    </Shell>
  );
}
