import Link from "next/link";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ListingCard, Empty } from "@/components/ui";
import type { Listing, Paged } from "@/lib/types";

export const metadata = {
  title: "Property listings",
  description: "Verified apartments, villas, plots and offices for sale and rent across India.",
};

const CITIES = ["Gurgaon", "Noida", "Greater Noida", "Delhi", "Mumbai", "Pune", "Bengaluru", "Hyderabad"];

/** Public search. Cached briefly, so a spike in traffic does not reach the database. */
export default async function ListingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [user, token] = await Promise.all([getUser(), getToken()]);

  const query = new URLSearchParams({ limit: "24" });
  for (const key of ["city", "locality", "purpose", "kind", "bhk", "minPrice", "maxPrice", "possession", "cursor"]) {
    if (sp[key]) query.set(key, sp[key]!);
  }
  if (!sp.purpose) query.set("purpose", "sale");

  const results = await api<Paged<Listing>>(`/v1/listings?${query}`, { revalidate: 30 })
    .catch(() => ({ items: [], nextCursor: null }));

  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp as Record<string, string>);
    for (const [k, v] of Object.entries(patch)) v === undefined ? next.delete(k) : next.set(k, v);
    next.delete("cursor");
    return `/listings?${next}`;
  };
  const purpose = sp.purpose ?? "sale";

  return (
    <Shell user={user} current="/listings">
      <div className="g2">
        <aside className="left sticky card pad col">
          <div className="row" style={{ background: "var(--chip)", borderRadius: 12, padding: 4 }}>
            {(["sale", "rent"] as const).map((p) => (
              <Link key={p} href={link({ purpose: p })} className="chip"
                style={{ flex: 1, justifyContent: "center", border: 0, background: purpose === p ? "var(--card)" : "transparent" }}>
                {p === "sale" ? "Buy" : "Rent"}
              </Link>
            ))}
          </div>

          <div>
            <h4 className="small" style={{ margin: "4px 0 8px" }}>City</h4>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <Link href={link({ city: undefined })} className={`chip ${!sp.city ? "on" : ""}`}>All</Link>
              {CITIES.map((c) => <Link key={c} href={link({ city: c })} className={`chip ${sp.city === c ? "on" : ""}`}>{c}</Link>)}
            </div>
          </div>

          <div>
            <h4 className="small" style={{ margin: "4px 0 8px" }}>Bedrooms</h4>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <Link href={link({ bhk: undefined })} className={`chip ${!sp.bhk ? "on" : ""}`}>Any</Link>
              {[1, 2, 3, 4, 5].map((b) => (
                <Link key={b} href={link({ bhk: String(b) })} className={`chip ${sp.bhk === String(b) ? "on" : ""}`}>
                  {b === 5 ? "5+" : `${b} BHK`}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h4 className="small" style={{ margin: "4px 0 8px" }}>Budget</h4>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {(purpose === "rent"
                ? [["25000", "Up to ₹25k"], ["50000", "Up to ₹50k"], ["100000", "Up to ₹1 L"]]
                : [["5000000", "Up to ₹50 L"], ["10000000", "Up to ₹1 Cr"], ["20000000", "Up to ₹2 Cr"], ["50000000", "Up to ₹5 Cr"]]
              ).map(([v, label]) => (
                <Link key={v} href={link({ maxPrice: v })} className={`chip ${sp.maxPrice === v ? "on" : ""}`}>{label}</Link>
              ))}
            </div>
          </div>
        </aside>

        <section>
          <div className="spread" style={{ marginBottom: 14 }}>
            <div>
              <h1 style={{ fontSize: 24 }}>
                {purpose === "rent" ? "Homes for rent" : "Properties for sale"}{sp.city ? ` in ${sp.city}` : ""}
              </h1>
              <p className="muted small">{results.items.length}{results.nextCursor ? "+" : ""} results</p>
            </div>
            {user ? <Link href="/listings/new" className="btn btn-ai">+ Add listing</Link> : null}
          </div>

          {results.items.length ? (
            <>
              <div className="lgrid">{results.items.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
              {results.nextCursor ? (
                <div style={{ textAlign: "center", marginTop: 18 }}>
                  <Link href={`/listings?${new URLSearchParams({ ...(sp as Record<string, string>), cursor: results.nextCursor })}`} className="btn btn-o">
                    Show more listings
                  </Link>
                </div>
              ) : null}
            </>
          ) : (
            <Empty title="No listings match these filters" text="Try a wider budget, another city, or fewer filters."
              action={<Link href="/listings" className="btn btn-o">Clear filters</Link>} />
          )}
        </section>
      </div>
    </Shell>
  );
}
