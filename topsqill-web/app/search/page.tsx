import Link from "next/link";
import { api } from "@/lib/api";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Avatar, TypePill, Empty } from "@/components/ui";
import { inr, sqft, imageUrl } from "@/lib/format";
import { EMPTY, type SearchResults } from "@/lib/search";

export const dynamic = "force-dynamic";

const TABS = [["all", "All"], ["people", "People"], ["listings", "Listings"], ["localities", "Localities"], ["jobs", "Jobs"]] as const;
type Tab = (typeof TABS)[number][0];

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return { title: q ? `“${q}”: search` : "Search", robots: { index: false } };
}

/** Full search results, opened by pressing Enter in the top bar. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const tab: Tab = (TABS.map((t) => t[0]) as string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "all";
  const user = await getUser();

  const res = q.length >= 2
    ? await api<SearchResults>(`/v1/search?q=${encodeURIComponent(q)}&limit=${tab === "all" ? 8 : 30}${tab === "all" ? "" : `&only=${tab}`}`, { revalidate: 30 }).catch(() => EMPTY)
    : EMPTY;
  const show = (k: Exclude<Tab, "all">) => tab === "all" || tab === k;
  const total = res.people.length + res.listings.length + res.localities.length + res.jobs.length;
  const href = (t: Tab) => `/search?q=${encodeURIComponent(q)}${t === "all" ? "" : `&tab=${t}`}`;
  const more = (t: Exclude<Tab, "all">, n: number) => tab === "all" && n >= 8 ? <Link href={href(t)} className="small" style={{ fontWeight: 800 }}>See all →</Link> : null;

  return (
    <Shell user={user} current="/search">
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>{q ? <>Results for “{q}”</> : "Search"}</h1>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Search by name, company, locality, city, or what you need, such as “3 BHK Sector 65” or “sales manager Noida”.
      </p>
      {q ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {TABS.map(([k, label]) => <Link key={k} href={href(k)} className={`chip ${tab === k ? "on" : ""}`} style={{ textDecoration: "none" }}>{label}</Link>)}
        </div>
      ) : null}

      {q.length < 2 ? <Empty title="What are you looking for?" text="Type at least two letters in the search box above." />
        : total === 0 ? <Empty title={`Nothing matches “${q}”`} text="Check the spelling, try fewer words, or search a locality or city." /> : null}

      {show("people") && res.people.length ? (
        <section className="card pad" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ marginBottom: 6 }}><h2 style={{ fontSize: 18 }}>People</h2>{more("people", res.people.length)}</div>
          {res.people.map((p) => (
            <Link key={p.id} href={`/profile/${p.id}`} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--line)", textDecoration: "none" }}>
              <Avatar person={p} size={46} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><b>{p.name}</b><TypePill type={p.type} />{p.kycVerified ? <span className="tag" style={{ color: "#4A86D4" }}>✓ KYC</span> : null}</div>
                <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.headline ?? [p.agency, p.city].filter(Boolean).join(" · ")}</div>
              </div>
            </Link>
          ))}
        </section>
      ) : null}

      {show("listings") && res.listings.length ? (
        <section style={{ marginBottom: 16 }}>
          <div className="spread" style={{ marginBottom: 10 }}><h2 style={{ fontSize: 18 }}>Listings</h2>{more("listings", res.listings.length)}</div>
          <div className="lgrid">
            {res.listings.map((l) => {
              const img = imageUrl(l.cover, "card");
              return (
                <Link key={l.id} href={`/listings/${l.id}`} className="card lc" style={{ textDecoration: "none" }}>
                  <div className="art">{img ? <img src={img} alt={l.title} loading="lazy" /> : <div style={{ width: "100%", height: "100%", background: "var(--brand)", opacity: .15 }} />}</div>
                  <div className="lb">
                    <div className="lp">{inr(l.priceInr, l.purpose === "rent")}</div>
                    <div className="lt">{l.title}</div>
                    <div className="small muted">📍 {l.locality}, {l.city}</div>
                    <div className="spec">{l.bhk ? <span>🛏 {l.bhk} BHK</span> : null}{l.areaSqft ? <span>📐 {sqft(l.areaSqft)}</span> : null}{l.verified ? <span>✓ Verified</span> : null}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {show("localities") && res.localities.length ? (
        <section className="card pad" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ marginBottom: 6 }}><h2 style={{ fontSize: 18 }}>Localities</h2>{more("localities", res.localities.length)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {res.localities.map((x) => (
              <Link key={x.locality + x.city} href={`/listings?city=${encodeURIComponent(x.city)}&locality=${encodeURIComponent(x.locality)}`}
                style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", textDecoration: "none" }}>
                <b>📍 {x.locality}</b><div className="small muted">{x.city} · {x.listings} listing{x.listings === 1 ? "" : "s"}</div>
                {x.avgRate ? <div className="small">Avg ₹{x.avgRate.toLocaleString("en-IN")} per sq ft</div> : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {show("jobs") && res.jobs.length ? (
        <section className="card pad" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ marginBottom: 6 }}><h2 style={{ fontSize: 18 }}>Jobs</h2>{more("jobs", res.jobs.length)}</div>
          {res.jobs.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="spread" style={{ padding: "10px 0", borderTop: "1px solid var(--line)", textDecoration: "none" }}>
              <span><b>{j.title}</b><div className="small muted">{j.company} · {j.locality ? `${j.locality}, ` : ""}{j.city}</div></span>
              {j.salaryMin ? <span className="small" style={{ fontWeight: 800, color: "#0E9F6E" }}>₹{Number(j.salaryMin)}–{Number(j.salaryMax)} LPA</span> : null}
            </Link>
          ))}
        </section>
      ) : null}
    </Shell>
  );
}
