import Link from "next/link";
import { DemoButton } from "@/components/DemoButton";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Avatar, Empty, ListingCard, TypePill } from "@/components/ui";
import { Composer, PostCard, MoreFeed } from "@/components/Feed";
import { inr, timeAgo, compact } from "@/lib/format";
import type { Listing, Paged, Post, Requirement } from "@/lib/types";

export const dynamic = "force-dynamic";

type Stats = { strength: { score: number; next: string[] }; viewers30d: number; listingViews: number; recentViewers: { id: string; name: string }[] };
type Sidebar = {
  city: string | null;
  hotLocalities: { locality: string; city: string; listings: number; avgRatePerSqft: number | null }[];
  jobs: { id: string; title: string; company: string; city: string; locality?: string | null; createdAt: string }[];
  launches: { id: string; name: string; builder?: string | null; city: string; locality: string; status: string; fromPrice: number | null; bhks: number[] }[];
};

/** Home: the feed for members, and a landing page for everyone else. */
const FILTERS = [["", "All"], ["following", "Following"], ["listings", "Listings"], ["requirements", "Requirements"], ["projects", "Projects"], ["jobs", "Jobs"], ["insights", "Insights"]] as const;

export default async function HomePage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const [user, token, q] = await Promise.all([getUser(), getToken(), searchParams]);
  const filter = FILTERS.some(([k]) => k && k === q.f) ? q.f! : "";

  if (!user) {
    const latest = await api<Paged<Listing>>("/v1/listings?limit=6", { revalidate: 60 }).catch(() => ({ items: [], nextCursor: null }));
    return (
      <Shell user={null} current="/">
        <section className="card pad" style={{ background: "var(--brand)", color: "#fff", border: 0, marginBottom: 20 }}>
          <h1 style={{ fontSize: 34, fontWeight: 800 }}>Real estate, done together</h1>
          <p style={{ maxWidth: "58ch", margin: "10px 0 18px", opacity: .95 }}>
            Topsqill.ai is where dealers, builders, buyers and owners meet. Verified listings, buyer requirements,
            leads in one inbox, and AI that writes the boring parts for you.
          </p>
          <div className="row">
            <Link href="/signup" className="btn" style={{ background: "#fff", color: "#1F1D33" }}>Join Topsqill.ai</Link>
            <Link href="/listings" className="btn" style={{ border: "2px solid rgba(255,255,255,.7)", color: "#fff" }}>Browse listings</Link>
            <DemoButton className="btn" style={{ border: "2px solid rgba(255,255,255,.7)", color: "#fff", background: "transparent" }} />
          </div>
        </section>
        <h2 style={{ fontSize: 22, margin: "0 0 12px" }}>Latest listings</h2>
        <div className="lgrid">{latest.items.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
      </Shell>
    );
  }

  const [feed, unreadNotifs, inbox, requirements, stats, side] = await Promise.all([
    api<Paged<Post>>(`/v1/feed?limit=12${filter ? `&filter=${filter}` : ""}`, { token }).catch(() => ({ items: [], nextCursor: null })),
    api<{ unread: number }>("/v1/notifications/unread", { token }).catch(() => ({ unread: 0 })),
    api<{ items: { unread: number }[] }>("/v1/conversations", { token }).catch(() => ({ items: [] })),
    api<Paged<Requirement>>(`/v1/requirements?limit=3${user.city ? `&city=${encodeURIComponent(user.city)}` : ""}`, { token })
      .catch(() => ({ items: [], nextCursor: null })),
    api<Stats>("/v1/me/stats", { token }).catch(() => null),
    api<Sidebar>("/v1/home/sidebar", { token }).catch(() => null),
  ]);
  const unreadMessages = inbox.items.reduce((n, c) => n + (c.unread ?? 0), 0);

  return (
    <Shell user={user} current="/" unread={{ messages: unreadMessages, notifications: unreadNotifs.unread }}>
      <div className="g3">
        <aside className="left sticky col">
          <div className="card" style={{ overflow: "hidden", textAlign: "center" }}>
            <div style={{ height: 60, background: "var(--brand)" }} />
            <div style={{ marginTop: -32 }}><Avatar person={user} media={user.avatar as never} size={66} /></div>
            <div className="pad" style={{ paddingTop: 8 }}>
              <h3 style={{ fontSize: 17 }}><Link href={`/profile/${user.id}`}>{user.name}</Link></h3>
              <p className="small muted" style={{ margin: "4px 0 8px" }}>{user.headline ?? "Complete your profile"}</p>
              <TypePill type={user.type} />
            </div>
            <div className="spread small" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
              <span className="muted">Connections</span><b>{compact(user.connectionCount)}</b>
            </div>
            <div className="spread small" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
              <span className="muted">Listings</span><b>{compact(user.listingCount)}</b>
            </div>
            {stats ? (
              <>
                <Link href={`/profile/${user.id}`} className="spread small" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)", textDecoration: "none", color: "inherit" }}
                  title={stats.recentViewers.length ? `Recently: ${stats.recentViewers.map((v) => v.name).join(", ")}` : undefined}>
                  <span className="muted">Profile viewers (30 days)</span><b>{compact(stats.viewers30d)}</b>
                </Link>
                <div className="spread small" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
                  <span className="muted">Listing views</span><b>{compact(stats.listingViews)}</b>
                </div>
                <div style={{ padding: "10px 16px 14px", borderTop: "1px solid var(--line)", textAlign: "left" }}>
                  <div className="spread small"><span className="muted">Profile strength</span><b>{stats.strength.score}%</b></div>
                  <div style={{ height: 6, borderRadius: 6, background: "var(--chip)", marginTop: 6, overflow: "hidden" }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.strength.score} aria-label="Profile strength">
                    <i style={{ display: "block", height: "100%", width: `${stats.strength.score}%`, background: stats.strength.score >= 80 ? "#2E9E90" : "var(--vio)" }} />
                  </div>
                  {stats.strength.next.length ? (
                    <Link href={stats.strength.next[0].includes("KYC") || stats.strength.next[0].includes("RERA") ? "/profile/verify" : stats.strength.next[0].includes("listing") ? "/listings/new" : "/profile/edit"}
                      className="small" style={{ display: "block", marginTop: 6 }}>Next: {stats.strength.next[0]} →</Link>
                  ) : <div className="small muted" style={{ marginTop: 6 }}>All-star profile ✨</div>}
                </div>
              </>
            ) : null}
          </div>
          <div className="card pad col" style={{ gap: 8 }}>
            <Link href="/listings/new" className="btn btn-ai sm">+ Add listing</Link>
            <Link href="/requirements/new" className="btn btn-o sm">Post a requirement</Link>
            <Link href="/leads" className="btn btn-g sm">My leads</Link>
          </div>
        </aside>

        <section className="col">
          <Composer user={user} />
          <nav className="row" aria-label="Show in the feed" style={{ gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map(([k, label]) => (
              <Link key={k || "all"} href={k ? `/?f=${k}` : "/"} className={`chip${filter === k ? " on" : ""}`} aria-current={filter === k ? "page" : undefined} scroll={false}>{label}</Link>
            ))}
          </nav>
          {feed.items.length
            ? <>
                {feed.items.map((p) => <PostCard key={p.id} post={p} meId={user.id} />)}
                <MoreFeed key={filter} cursor={feed.nextCursor} meId={user.id} filter={filter || undefined} />
              </>
            : filter
              ? <Empty title="Nothing here yet" text={filter === "following" ? "Connect with or follow people, and their posts will show here." : "No posts of this kind yet. Try All."}
                  action={<Link href="/" className="btn btn-o">Show all posts</Link>} />
              : <Empty title="Your feed is quiet" text="Connect with dealers and builders in your city, and their updates will show up here."
                  action={<Link href="/network" className="btn btn-ai">Find people</Link>} />}
        </section>

        <aside className="right sticky col">
          {side?.hotLocalities.length ? (
            <div className="card pad">
              <h3 style={{ fontSize: 16, marginBottom: 10 }}>🔥 Hot localities{side.city ? ` in ${side.city}` : ""}</h3>
              {side.hotLocalities.map((h, i) => (
                <Link key={`${h.locality}-${h.city}`} href={`/listings?city=${encodeURIComponent(h.city)}&locality=${encodeURIComponent(h.locality)}`}
                  className="spread small" style={{ padding: "8px 0", borderTop: i ? "1px solid var(--line)" : 0, textDecoration: "none", color: "inherit" }}>
                  <span><b>{h.locality}</b><br /><span className="muted">{h.listings} new listing{h.listings === 1 ? "" : "s"}</span></span>
                  {h.avgRatePerSqft ? <span className="muted" style={{ textAlign: "right" }}>₹{h.avgRatePerSqft.toLocaleString("en-IN")}<br />per sq ft</span> : null}
                </Link>
              ))}
            </div>
          ) : null}
          {side?.launches.length ? (
            <div className="card pad">
              <h3 style={{ fontSize: 16, marginBottom: 10 }}>🏗 New launches</h3>
              {side.launches.map((p, i) => (
                <Link key={p.id} href={`/projects/${p.id}`} style={{ display: "block", padding: "8px 0", borderTop: i ? "1px solid var(--line)" : 0, textDecoration: "none", color: "inherit" }}>
                  <b className="small">{p.name}</b>
                  <div className="small muted">{[p.builder, `${p.locality}, ${p.city}`].filter(Boolean).join(" · ")}</div>
                  <div className="small">{p.bhks.length ? `${p.bhks.join(", ")} BHK` : p.status}{p.fromPrice ? ` · from ${inr(p.fromPrice)}` : ""}</div>
                </Link>
              ))}
            </div>
          ) : null}
          {side?.jobs.length ? (
            <div className="card pad">
              <h3 style={{ fontSize: 16, marginBottom: 10 }}>💼 Jobs for you</h3>
              {side.jobs.map((j, i) => (
                <Link key={j.id} href={`/jobs/${j.id}`} style={{ display: "block", padding: "8px 0", borderTop: i ? "1px solid var(--line)" : 0, textDecoration: "none", color: "inherit" }}>
                  <b className="small">{j.title}</b>
                  <div className="small muted">{j.company} · {j.locality ? `${j.locality}, ` : ""}{j.city} · {timeAgo(j.createdAt)}</div>
                </Link>
              ))}
              <Link href="/jobs" className="btn btn-g sm" style={{ marginTop: 8 }}>See all jobs</Link>
            </div>
          ) : null}
          <div className="card pad">
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>Buyers looking now</h3>
            {requirements.items.length ? requirements.items.map((r) => (
              <div key={r.id} style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                <b className="small">{r.bhk ? `${r.bhk} BHK ` : ""}in {r.localities[0] ?? r.city}</b>
                <div className="small muted">
                  {inr(r.minPrice, r.purpose === "rent")} to {inr(r.maxPrice, r.purpose === "rent")} · {timeAgo(r.createdAt)}
                </div>
              </div>
            )) : <p className="small muted">No open requirements in your city yet.</p>}
            <Link href="/requirements" className="btn btn-g sm" style={{ marginTop: 10 }}>See all requirements</Link>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
