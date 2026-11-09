import Link from "next/link";
import { Avatar } from "./ui";
import type { SessionUser } from "@/lib/session";

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

/** Top bar and mobile tab bar. Rendered on the server, so it needs no JavaScript. */
export function Shell({ user, current, unread, children }: {
  user: SessionUser | null; current: string; unread?: { messages?: number; notifications?: number };
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

          <form action="/listings" style={{ flex: 1, maxWidth: 320 }}>
            <input name="q" placeholder="Search listings, people, localities" aria-label="Search"
              style={{ width: "100%", height: 38, borderRadius: 999, border: "1.5px solid var(--line)", background: "var(--soft)", padding: "0 16px" }} />
          </form>

          <nav className="tabs">
            {TABS.map((t) => {
              const count = t.href === "/messages" ? unread?.messages : t.href === "/notifications" ? unread?.notifications : 0;
              return (
                <Link key={t.href} href={t.href} className={`tab ${current === t.href ? "on" : ""}`}>
                  <span aria-hidden>{t.icon}</span>
                  <span>{t.label}</span>
                  {count ? <span className="badge-dot">{count > 9 ? "9+" : count}</span> : null}
                </Link>
              );
            })}
            {user?.isAdmin ? (
              <Link href="/admin" className={`tab ${current.startsWith("/admin") ? "on" : ""}`}>
                <span aria-hidden>🛡</span><span>Admin</span>
              </Link>
            ) : null}
            {user ? (
              <Link href={`/profile/${user.id}`} className={`tab ${current.startsWith("/profile") ? "on" : ""}`}>
                <Avatar person={user} media={user.avatar as never} size={24} />
                <span>Me</span>
              </Link>
            ) : (
              <>
                <Link href="/signin" className="btn btn-g" style={{ alignSelf: "center", marginLeft: 8 }}>Sign in</Link>
                <Link href="/signup" className="btn btn-ai" style={{ alignSelf: "center", marginLeft: 6 }}>Join</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="wrap">{children}</main>

      <nav className="bbar" aria-label="Main">
        {[TABS[0], TABS[1], TABS[2], TABS[5], TABS[6]].map((t) => (
          <Link key={t.href} href={t.href} className={current === t.href ? "on" : ""}>
            <span aria-hidden style={{ fontSize: 20 }}>{t.icon}</span>
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
