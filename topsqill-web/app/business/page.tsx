import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";

export const metadata = { title: "Business profiles" };
export const dynamic = "force-dynamic";

type Business = { id: string; name: string; industryId: string; recommendations: { industry: { label: string } } };

export default async function BusinessListPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin?next=/business");
  const { items } = await api<{ items: Business[] }>("/v1/business", { token }).catch(() => ({ items: [] as Business[] }));

  return (
    <Shell user={user} current="/leads">
      <Link href="/campaigns" className="small muted">← Campaigns</Link>
      <div className="spread" style={{ margin: "6px 0 16px" }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Your businesses</h1>
          <p className="muted small">Marketing for anything other than real estate - set up a business profile, get industry-matched objectives and a draft plan.</p>
        </div>
        <Link href="/business/new" className="btn btn-ai">+ New business</Link>
      </div>

      {items.length ? (
        <div className="col" style={{ gap: 10 }}>
          {items.map((b) => (
            <Link key={b.id} href={`/business/${b.id}`} className="card pad" style={{ textDecoration: "none" }}>
              <b>{b.name}</b>
              <div className="small muted">{b.recommendations.industry.label}</div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No business profiles yet" text="Running a clothing store, a clinic, a SaaS product or anything else that isn't real estate? Describe it in a sentence and get industry-matched objectives, conversion events and a draft budget plan."
          action={<Link href="/business/new" className="btn btn-ai">Set up a business</Link>} />
      )}
    </Shell>
  );
}
