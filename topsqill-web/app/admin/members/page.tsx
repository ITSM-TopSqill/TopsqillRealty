import Link from "next/link";
import { api } from "@/lib/api";
import { getToken } from "@/lib/session";
import { MemberRow } from "@/components/admin/MemberRow";
import { Empty } from "@/components/ui";

export type AdminMember = {
  id: string; name: string; type: string; status: string; city?: string | null;
  phone?: string | null; kycVerified: boolean; reraVerified: boolean;
  listingCount: number; connectionCount: number; createdAt: string;
};

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ search?: string; type?: string; status?: string }> }) {
  const [sp, token] = await Promise.all([searchParams, getToken()]);
  const q = new URLSearchParams({ limit: "50" });
  for (const k of ["search", "type", "status"]) if (sp[k as keyof typeof sp]) q.set(k, sp[k as keyof typeof sp]!);
  const members = await api<{ items: AdminMember[] }>(`/v1/admin/members?${q}`, { token }).catch(() => ({ items: [] }));

  const chip = (patch: Record<string, string | undefined>, label: string, active: boolean) => {
    const next = new URLSearchParams(sp as Record<string, string>);
    for (const [k, v] of Object.entries(patch)) v === undefined ? next.delete(k) : next.set(k, v);
    return <Link key={label} href={`/admin/members?${next}`} className={`chip ${active ? "on" : ""}`}>{label}</Link>;
  };

  return (
    <>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Members</h1>
      <p className="muted small" style={{ marginBottom: 14 }}>
        Verify, suspend or remove members. Suspending also hides that member’s listings straight away.
      </p>

      <form action="/admin/members" className="row" style={{ marginBottom: 12 }}>
        <input name="search" defaultValue={sp.search ?? ""} placeholder="Search by name, phone or agency"
          style={{ flex: 1, maxWidth: 320, height: 38, borderRadius: 999, border: "1.5px solid var(--line)", padding: "0 16px", background: "var(--card)" }} />
        <button className="btn btn-o sm">Search</button>
      </form>

      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {chip({ type: undefined }, "All types", !sp.type)}
        {["dealer", "builder", "buyer", "seller"].map((t) => chip({ type: t }, t, sp.type === t))}
        {chip({ status: undefined }, "Any status", !sp.status)}
        {["active", "suspended"].map((s) => chip({ status: s }, s, sp.status === s))}
      </div>

      {members.items.length ? (
        <div className="card" style={{ overflow: "hidden" }}>
          {members.items.map((m) => <MemberRow key={m.id} member={m} />)}
        </div>
      ) : <Empty title="No members match" text="Try a different search or filter." />}
    </>
  );
}
