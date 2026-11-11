import Link from "next/link";
import type { SessionUser } from "@/lib/session";
import { LiveBadge, LiveAlerts } from "./Live";
import { Suspense } from "react";
import { SearchBox } from "./SearchBox";
import { MessageDock } from "./MessageDock";
import { MeMenu } from "./MeMenu";

const TABS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/network", label: "My Network", icon: "👥" },
  { href: "/listings", label: "Listings", icon: "🏢" },
  { href: "/requirements", label: "Requirements", icon: "📋" },
  { href: "/jobs", label: "Jobs", icon: "💼" },
  { href: "/leads", label: "Leads", icon: "🎯" },
  { href: "/messages", label: "Messages", icon: "💬" },
  { href: "/notifications", label: "Alerts", icon: "🔔" },
];

/**
 * Top bar and mobile tab bar. Rendered on the server, so it needs no JavaScript.
 * `user` is undefined while a page is loading: the member's own links are left
 * out rather than flashing "Sign in" at someone who is signed in.
 */
export function Shell({ user, current, unread, children }: {
  user: SessionUser | null | undefined; current: string; unread?: { messages?: number; notifications?: number };
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="nav">
        <div className="nav-in">
          <Link href="/" className="logo" aria-label="Topsqill.ai home">
            <span className="logo-mark">t</span>
            <span className="logo-word">Topsqill.ai</span>
          </Link>

          <Suspense fallback={<div className="searchbox" />}><SearchBox /></Suspense>
          {user ? (
            <Link href="/assistant" className="ask-ai" title="Ask Topsqill.ai" aria-current={current === "/assistant" ? "page" : undefined}>
              <span aria-hidden>✨</span><span className="ask-ai-t">AI</span>
            </Link>
          ) : null}

          <nav className="tabs">
            {TABS.map((t) => {
              const kind = t.href === "/messages" ? "messages" : t.href === "/notifications" ? "notifications" : null;
              return (
                <Link key={t.href} href={t.href} className={`tab ${current === t.href ? "on" : ""}`}>
                  <span aria-hidden>{t.icon}</span>
                  <span>{t.label}</span>
                  {kind && user ? <LiveBadge kind={kind} initial={unread?.[kind]} /> : null}
                </Link>
              );
            })}
            {user?.isAdmin ? (
              <Link href="/admin" className={`tab ${current.startsWith("/admin") ? "on" : ""}`}>
                <span aria-hidden>🛡</span><span>Admin</span>
              </Link>
            ) : null}
          </nav>
          {/* Outside the tabs, so it stays on phones, where the tabs are hidden. */}
          {user ? <MeMenu user={user} current={current} /> : user === undefined ? null : (
            <div className="row" style={{ gap: 6, flex: "none" }}>
              <Link href="/signin" className="btn btn-g">Sign in</Link>
              <Link href="/signup" className="btn btn-ai nav-join">Join</Link>
            </div>
          )}
        </div>
      </header>

      <main className="wrap">{children}</main>
      {user ? <LiveAlerts /> : null}
      {user ? <MessageDock me={{ id: user.id, name: user.name, type: user.type, avatar: user.avatar }} /> : null}

      <nav className="bbar" aria-label="Main">
        {[TABS[0], TABS[1], TABS[2], TABS[5], TABS[6]].map((t) => (
          <Link key={t.href} href={t.href} className={current === t.href ? "on" : ""} style={{ position: "relative" }}>
            <span aria-hidden style={{ fontSize: 20 }}>{t.icon}</span>
            <span>{t.label}</span>
            {t.href === "/messages" && user ? <LiveBadge kind="messages" initial={unread?.messages} /> : null}
          </Link>
        ))}
      </nav>
    </>
  );
}
