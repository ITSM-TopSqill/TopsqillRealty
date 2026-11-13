import Link from "next/link";

const TABS = [
  { href: "/settings/alerts", icon: "🔔", label: "Alerts", hint: "Emails and phone notifications" },
  { href: "/settings/privacy", icon: "🛡", label: "Privacy & blocking", hint: "Members you blocked" },
  { href: "/settings/account", icon: "👤", label: "Account", hint: "Sign-in details, delete account" },
] as const;

/** Settings pages share one frame: a side menu on computers, tabs on phones. */
export function SettingsFrame({ current, title, intro, children }: { current: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="st">
      <aside className="st-side">
        <h1 className="st-h">Settings</h1>
        <nav className="card st-nav" aria-label="Settings">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={`st-tab ${current === t.href ? "on" : ""}`} aria-current={current === t.href ? "page" : undefined}>
              <span aria-hidden className="st-ico">{t.icon}</span>
              <span className="st-txt"><b>{t.label}</b><small className="muted">{t.hint}</small></span>
            </Link>
          ))}
        </nav>
      </aside>
      <section className="st-main">
        <header style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>{title}</h2>
          {intro ? <p className="muted small" style={{ margin: "4px 0 0", maxWidth: "70ch" }}>{intro}</p> : null}
        </header>
        {children}
      </section>
      <style>{`
        .st{display:grid;grid-template-columns:260px minmax(0,1fr);gap:20px;align-items:start}
        .st-h{font-size:24px;margin:0 0 12px}
        .st-nav{padding:6px;display:flex;flex-direction:column;gap:2px;position:sticky;top:76px}
        .st-tab{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;color:var(--ink);text-decoration:none}
        .st-tab:hover{background:var(--soft)}
        .st-tab.on{background:var(--soft);box-shadow:inset 3px 0 0 var(--vio)}
        .st-ico{font-size:18px;width:24px;text-align:center}
        .st-txt{display:flex;flex-direction:column;min-width:0}
        .st-txt small{font-size:12px}
        .st-main{min-width:0}
        @media (max-width:820px){
          .st{grid-template-columns:minmax(0,1fr);gap:12px}
          .st-nav{flex-direction:row;overflow-x:auto;position:static;scrollbar-width:none}
          .st-nav::-webkit-scrollbar{display:none}
          .st-tab{flex:0 0 auto;padding:8px 12px}
          .st-tab.on{box-shadow:inset 0 -3px 0 var(--vio)}
          .st-txt small{display:none}
        }
      `}</style>
    </div>
  );
}
