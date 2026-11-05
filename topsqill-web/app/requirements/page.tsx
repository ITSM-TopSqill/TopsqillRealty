import Link from "next/link";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Avatar, TypePill, Empty } from "@/components/ui";
import { MatchesButton } from "@/components/MatchesButton";
import { inr, timeAgo } from "@/lib/format";
import type { Paged, Requirement } from "@/lib/types";

export const metadata = {
  title: "Buyer requirements",
  description: "What buyers and tenants are looking for right now, across India.",
};
export const revalidate = 30;

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  const [{ city }, user, token] = await Promise.all([searchParams, getUser(), getToken()]);
  const list = await api<Paged<Requirement>>(`/v1/requirements?limit=30${city ? `&city=${encodeURIComponent(city)}` : ""}`, { revalidate: 30 })
    .catch(() => ({ items: [], nextCursor: null }));

  const cities = ["Gurgaon", "Noida", "Delhi", "Mumbai", "Pune", "Bengaluru", "Hyderabad"];

  return (
    <Shell user={user} current="/requirements">
      <div className="card pad" style={{ background: "linear-gradient(115deg,#2E9E90,#4A86D4)", color: "#fff", border: 0, marginBottom: 16 }}>
        <h1 style={{ fontSize: 26 }}>Requirements board</h1>
        <p style={{ maxWidth: "62ch", margin: "8px 0 14px", opacity: .95 }}>
          Buyers and tenants post what they want. Topsqill.ai matches every requirement against verified listings,
          so dealers can reply with something that actually fits.
        </p>
        <Link href="/requirements/new" className="btn" style={{ background: "#fff", color: "#1F1D33" }}>+ Post a requirement</Link>
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        <Link href="/requirements" className={`chip ${!city ? "on" : ""}`}>All cities</Link>
        {cities.map((c) => (
          <Link key={c} href={`/requirements?city=${encodeURIComponent(c)}`} className={`chip ${city === c ? "on" : ""}`}>{c}</Link>
        ))}
      </div>

      {list.items.length ? (
        <div className="col">
          {list.items.map((r) => (
            <article key={r.id} className="card pad">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <Avatar person={{ id: r.userId!, name: r.userName ?? "Buyer", type: r.userType }} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <Link href={`/profile/${r.userId}`} style={{ fontWeight: 800 }}>{r.userName}</Link>
                    <TypePill type={r.userType} />
                    <span className="small muted">{timeAgo(r.createdAt)}</span>
                  </div>
                  <div className="small muted">{r.userHeadline}</div>
                </div>
              </div>

              <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: "var(--soft)" }}>
                <b style={{ fontSize: 17 }}>
                  {r.bhk ? `${r.bhk} BHK ` : ""}{r.kind.toLowerCase()} to {r.purpose === "rent" ? "rent" : "buy"} in {r.city}
                </b>
                <div className="muted small" style={{ marginTop: 2 }}>
                  Budget {inr(r.minPrice, r.purpose === "rent")} to {inr(r.maxPrice, r.purpose === "rent")}
                  {r.timeline ? ` · moving ${r.timeline}` : ""}
                  {r.needsLoan ? " · needs a home loan" : ""}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
                  {r.localities.map((l) => <span key={l} className="tag">📍 {l}</span>)}
                </div>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span className="small muted">{r.matchCount} matching listings</span>
                  <MatchesButton requirementId={r.id} />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No open requirements here yet" text="Post what you are looking for and dealers will reply with matching listings."
          action={<Link href="/requirements/new" className="btn btn-ai">Post a requirement</Link>} />
      )}
    </Shell>
  );
}
