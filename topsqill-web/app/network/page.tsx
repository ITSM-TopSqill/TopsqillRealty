import { redirect } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { AcceptIgnore } from "@/components/AcceptIgnore";
import { ShareProfile } from "@/components/ShareProfile";
import { PersonRow, since } from "@/components/network/PersonRow";
import { SuggestionGrid } from "@/components/network/SuggestionGrid";
import { ConnectionList } from "@/components/network/ConnectionList";
import { WithdrawButton, MessageButton } from "@/components/network/NetworkActions";
import type { NetPage, NetSummary } from "@/components/network/types";

export const metadata = { title: "My Network" };
export const dynamic = "force-dynamic";

const TABS = ["grow", "invitations", "sent", "connections"] as const;
type Tab = (typeof TABS)[number];
const KINDS = [["", "All"], ["dealer", "Dealers"], ["builder", "Builders"], ["buyer", "Buyers"], ["seller", "Owners"]] as const;
const EMPTY: NetPage = { items: [], nextOffset: null, total: 0 };

/**
 * My Network, in sections: grow your network (people you may know), invitations
 * waiting for me, invitations I've sent, and my connections. A menu with
 * counts on the left (tabs along the top on phones) moves between them.
 */
export default async function NetworkPage({ searchParams }: { searchParams: Promise<{ tab?: string; type?: string }> }) {
  const [user, token, sp] = await Promise.all([getUser(), getToken(), searchParams]);
  if (!user) redirect("/signin?next=/network");
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "grow";
  const kind = KINDS.some(([k]) => k && k === sp.type) ? sp.type! : "";

  const get = <T,>(path: string, fallback: T) => api<T>(path, { token }).catch(() => fallback);
  const summary = await get<NetSummary>("/v1/connections/summary", { connections: 0, pending: 0, sent: 0, dealers: 0, builders: 0, buyers: 0, sellers: 0 });
  const [pending, sent, connected, suggestions] = await Promise.all([
    tab === "grow" || tab === "invitations" ? get<NetPage>(`/v1/connections?status=pending&limit=${tab === "grow" ? 3 : 100}`, EMPTY) : EMPTY,
    tab === "sent" ? get<NetPage>("/v1/connections?status=sent&limit=100", EMPTY) : EMPTY,
    tab === "connections" ? get<NetPage>("/v1/connections?status=accepted&limit=30", EMPTY) : EMPTY,
    tab === "grow" ? get<NetPage>(`/v1/connections/suggestions?limit=12${kind ? `&type=${kind}` : ""}`, EMPTY) : EMPTY,
  ]);

  const nav: [Tab, string, string, number][] = [
    ["grow", "🌱", "Grow your network", 0],
    ["invitations", "📨", "Invitations", summary.pending],
    ["sent", "📤", "Sent", summary.sent],
    ["connections", "🤝", "Connections", summary.connections],
  ];

  return (
    <Shell user={user} current="/network">
      <div className="nw">
        <aside className="nw-side">
          <div className="card nw-menu-card">
            <h1 className="nw-title">My Network</h1>
            <nav aria-label="My Network sections" className="nw-nav">
              {nav.map(([k, icon, label, n]) => (
                <Link key={k} href={k === "grow" ? "/network" : `/network?tab=${k}`} className={`nw-link${tab === k ? " on" : ""}`} aria-current={tab === k ? "page" : undefined}>
                  <span aria-hidden>{icon}</span><span className="nw-l">{label}</span>
                  {n ? <span className={`nw-count${k === "invitations" ? " hot" : ""}`}>{n.toLocaleString("en-IN")}</span> : null}
                </Link>
              ))}
            </nav>
          </div>
          {summary.connections ? (
            <div className="card pad nw-break">
              <b className="small">Your network</b>
              {[["Dealers", summary.dealers, "#D9668C", "dealer"], ["Builders", summary.builders, "#D9A441", "builder"], ["Buyers", summary.buyers, "#4A86D4", "buyer"], ["Owners", summary.sellers, "#2E9E90", "seller"]].map(([l, n, c]) => (
                <div key={l as string} className="nw-bar">
                  <span className="small">{l}</span><span className="small muted">{n as number}</span>
                  <i style={{ width: `${Math.round(((n as number) / summary.connections) * 100)}%`, background: c as string }} />
                </div>
              ))}
            </div>
          ) : null}
          <div className="card pad nw-invite">
            <b className="small">Bring your contacts</b>
            <p className="small muted" style={{ margin: "4px 0 8px" }}>Share your profile on WhatsApp with clients and colleagues so they can connect with you here.</p>
            <ShareProfile id={user.id} name={user.name} headline={user.headline} />
          </div>
        </aside>

        <main className="nw-main">
          {tab === "grow" ? (
            <>
              {summary.pending ? (
                <section className="card pad nw-sec">
                  <div className="spread nw-sh">
                    <h2>Invitations <span className="nw-count hot">{summary.pending}</span></h2>
                    {summary.pending > 3 ? <Link href="/network?tab=invitations" className="small">See all {summary.pending} →</Link> : null}
                  </div>
                  {pending.items.map((p) => (
                    <PersonRow key={p.id} p={p} meta={p.since ? `Sent ${since(p.since)}` : null}><AcceptIgnore peerId={p.id} /></PersonRow>
                  ))}
                </section>
              ) : null}
              <section className="card pad nw-sec">
                <div className="spread nw-sh" style={{ flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <h2>People you may know</h2>
                    <p className="small muted" style={{ margin: 0 }}>Based on mutual connections, your city and your line of work.</p>
                  </div>
                  <nav className="row" style={{ gap: 6, flexWrap: "wrap" }} aria-label="Show people who are">
                    {KINDS.map(([k, l]) => (
                      <Link key={k} href={k ? `/network?type=${k}` : "/network"} className={`chip${kind === k ? " on" : ""}`} aria-current={kind === k ? "true" : undefined}>{l}</Link>
                    ))}
                  </nav>
                </div>
                <SuggestionGrid key={kind} initial={suggestions.items} nextOffset={suggestions.nextOffset} type={kind} />
              </section>
            </>
          ) : null}

          {tab === "invitations" ? (
            <section className="card pad nw-sec">
              <div className="nw-sh">
                <h2>Invitations</h2>
                <p className="small muted" style={{ margin: 0 }}>People who want to connect with you. Accepting lets you message each other and see each other&apos;s posts.</p>
              </div>
              {pending.items.length ? pending.items.map((p) => (
                <PersonRow key={p.id} p={p} meta={p.since ? `Sent ${since(p.since)}` : null}><AcceptIgnore peerId={p.id} /></PersonRow>
              )) : <EmptyState icon="📨" title="You're all caught up" text="New invitations will appear here." cta={<Link href="/network" className="btn btn-o sm">Find people to connect with</Link>} />}
            </section>
          ) : null}

          {tab === "sent" ? (
            <section className="card pad nw-sec">
              <div className="nw-sh">
                <h2>Sent invitations</h2>
                <p className="small muted" style={{ margin: 0 }}>Waiting for a reply. Withdraw any you no longer want.</p>
              </div>
              {sent.items.length ? sent.items.map((p) => (
                <PersonRow key={p.id} p={p} meta={p.since ? `Sent ${since(p.since)}` : null}>
                  <MessageButton peerId={p.id} />
                  <WithdrawButton peerId={p.id} name={p.name} />
                </PersonRow>
              )) : <EmptyState icon="📤" title="No pending invitations" text="Invitations you send appear here until they're answered." cta={<Link href="/network" className="btn btn-o sm">Grow your network</Link>} />}
            </section>
          ) : null}

          {tab === "connections" ? (
            <section className="card pad nw-sec">
              <div className="nw-sh">
                <h2>Connections</h2>
                <p className="small muted" style={{ margin: 0 }}>Dealers, builders, buyers and owners you&apos;re connected with.</p>
              </div>
              <ConnectionList initial={connected} />
            </section>
          ) : null}
        </main>
      </div>

      <style>{`
        .nw{display:grid;grid-template-columns:270px minmax(0,1fr);gap:18px;align-items:start}
        .nw-side{position:sticky;top:76px;display:grid;gap:12px;min-width:0}
        .nw-menu-card{padding:14px 8px 8px}
        .nw-title{font-size:20px;padding:0 10px 8px}
        .nw-nav{display:grid;gap:2px}
        .nw-link{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;color:inherit;text-decoration:none;font-weight:600}
        .nw-link:hover{background:var(--soft)}
        .nw-link.on{background:color-mix(in srgb,var(--vio) 12%,transparent);color:var(--vio);font-weight:800}
        .nw-l{flex:1}
        .nw-count{font-size:12px;font-weight:800;padding:1px 8px;border-radius:999px;background:var(--chip);color:var(--ink2)}
        .nw-count.hot{background:var(--vio);color:#fff}
        .nw-break{display:grid;gap:8px}
        .nw-bar{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center}
        .nw-bar i{grid-column:1 / -1;height:6px;border-radius:999px;display:block;min-width:4px}
        .nw-main{display:grid;gap:16px;min-width:0}
        .nw-sec h2{font-size:18px;display:flex;align-items:center;gap:8px}
        .nw-sh{margin-bottom:10px}
        .nw-row{display:flex;align-items:center;gap:14px;padding:14px 4px;border-top:1px solid var(--line)}
        .nw-sh + .nw-row,.nw-tools + p + .nw-row{border-top:0}
        .nw-av{flex:0 0 auto}
        .nw-who{flex:1;min-width:0;overflow-wrap:anywhere}
        .nw-name{font-weight:800;color:inherit}
        .nw-name:hover{color:var(--vio)}
        .nw-badge{font-size:11px;font-weight:800}
        .nw-head{font-size:13.5px;color:var(--ink2);margin:2px 0 0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
        .nw-meta{font-size:12.5px;color:var(--ink3);margin-top:3px}
        .nw-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;flex:0 0 auto}
        .nw-menu{position:absolute;right:0;top:36px;z-index:20;min-width:190px;padding:4px}
        .nw-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
        .nw-tools select{min-width:140px}
        .nw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
        .nw-card{position:relative;border:1.5px solid var(--line);border-radius:16px;overflow:hidden;text-align:center;display:flex;flex-direction:column;background:var(--card);transition:box-shadow .15s,transform .15s}
        .nw-card:hover{box-shadow:0 8px 24px rgba(20,16,40,.10);transform:translateY(-1px)}
        .nw-cover{height:58px}
        .nw-cav{margin:-38px auto 0;display:inline-block}
        .nw-cbody{padding:8px 12px 4px;flex:1}
        .nw-reason{font-size:12px;color:var(--ink3);margin:4px 0 0}
        .nw-cbtn{margin:8px 12px 12px;justify-content:center}
        .nw-x{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.9);border:0;font-size:16px;line-height:1;cursor:pointer;color:#333;z-index:2}
        .nw-empty{text-align:center;padding:30px 10px}
        .nw-empty .ico{font-size:34px}
        @media (max-width: 900px){
          .nw{grid-template-columns:minmax(0,1fr)}
          .nw-side{position:static;display:block;min-width:0}
          .nw-break,.nw-invite{display:none}
          .nw-menu-card{padding:10px 6px 6px}
          .nw-title{font-size:20px;padding:0 8px 6px}
          .nw-nav{display:flex;overflow-x:auto;gap:4px;scrollbar-width:none}
          .nw-link{white-space:nowrap;padding:8px 12px;flex:0 0 auto}
        }
        @media (max-width: 560px){
          .nw-row{flex-wrap:wrap}
          .nw-act{width:100%;justify-content:flex-start;padding-left:70px}
          .nw-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        }
      `}</style>
    </Shell>
  );
}

function EmptyState({ icon, title, text, cta }: { icon: string; title: string; text: string; cta?: React.ReactNode }) {
  return (
    <div className="nw-empty">
      <div className="ico" aria-hidden>{icon}</div>
      <b>{title}</b>
      <p className="small muted" style={{ margin: "4px 0 10px" }}>{text}</p>
      {cta}
    </div>
  );
}
