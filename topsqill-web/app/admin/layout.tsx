import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, getToken } from "@/lib/session";
import { api } from "@/lib/api";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Overview", icon: "📊" },
  { href: "/admin/listings", label: "Listing reviews", icon: "🏠" },
  { href: "/admin/approvals", label: "KYC & RERA", icon: "✅" },
  { href: "/admin/campaigns", label: "Campaign reviews", icon: "📣" },
  { href: "/admin/ads", label: "Ads & wallets", icon: "👛" },
  { href: "/admin/moderation", label: "Moderation", icon: "🛡" },
  { href: "/admin/members", label: "Members", icon: "👥" },
  { href: "/admin/ai", label: "AI", icon: "✨" },
  { href: "/admin/connectors", label: "Connectors", icon: "🔌" },
  { href: "/admin/audit", label: "Audit log", icon: "📜" },
];

/**
 * The admin console has its own layout: a dark sidebar, no member navigation.
 * Access is checked here, so every page under /admin is protected by default.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin");

  // The API is the authority: if it refuses, this member is not an admin.
  const allowed = await api("/v1/admin/overview", { token }).then(() => true).catch(() => false);
  if (!allowed) {
    return (
      <main className="wrap" style={{ display: "grid", placeItems: "center", minHeight: "70vh", textAlign: "center" }}>
        <div>
          <h1 style={{ fontSize: 28 }}>Admins only</h1>
          <p className="muted" style={{ margin: "8px 0 18px" }}>This area is limited to the Topsqill.ai team.</p>
          <Link href="/" className="btn btn-ai">Back to Topsqill.ai</Link>
        </div>
      </main>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "232px minmax(0,1fr)", minHeight: "100vh" }}>
      <aside style={{ background: "#17133A", color: "#EFEDFF", padding: 18, position: "sticky", top: 0, height: "100vh" }}>
        <Link href="/" className="row" style={{ gap: 9, marginBottom: 22, textDecoration: "none" }}>
          <span className="logo-mark">t</span>
          <span style={{ fontWeight: 800, fontSize: 17 }}>Admin</span>
        </Link>
        <nav className="col" style={{ gap: 4 }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 10, fontWeight: 700, color: "#CFC9FF", textDecoration: "none" }}>
              <span aria-hidden>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <Link href="/" style={{ position: "absolute", bottom: 20, color: "#9B94D6", fontSize: 13 }}>← Back to the app</Link>
      </aside>
      <main style={{ padding: "24px 26px 60px", background: "var(--bg)" }}>{children}</main>
    </div>
  );
}
