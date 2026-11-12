import { api } from "@/lib/api";
import { getToken } from "@/lib/session";

export const metadata = { title: "Connectors" };

type Connector = { id: string; name: string; group: string; status: "on" | "off" | "warning"; detail: string; setup?: string };
const STATUS = { on: ["✓", "Connected", "#12B76A"], warning: ["!", "Needs attention", "#E08A00"], off: ["–", "Not set up", "#898781"] } as const;

/** Every outside service Topsqill uses, whether it's set up, and how to set it up. Secret values are never shown. */
export default async function AdminConnectors() {
  const token = await getToken();
  const { items } = await api<{ items: Connector[] }>("/v1/admin/connectors", { token });
  const groups = [...new Set(items.map((c) => c.group))];
  const on = items.filter((c) => c.status === "on").length;
  return (
    <>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Connectors</h1>
      <p className="muted small" style={{ marginBottom: 18 }}>{on} of {items.length} connected. Keys live in Google Secret Manager; this page only shows whether each one is set.</p>
      {groups.map((g) => (
        <section key={g} className="card pad" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, marginBottom: 6 }}>{g}</h2>
          {items.filter((c) => c.group === g).map((c) => {
            const [icon, label, color] = STATUS[c.status];
            return (
              <div key={c.id} className="spread" style={{ padding: "10px 0", borderTop: "1px solid var(--line)", gap: 12, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <b>{c.name}</b>
                  <div className="small muted">{c.detail}</div>
                  {c.status !== "on" && c.setup ? <div className="small" style={{ marginTop: 2 }}>To set up: <code>{c.setup}</code></div> : null}
                </div>
                <span className="pill" style={{ whiteSpace: "nowrap", color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
                  <span aria-hidden>{icon}</span> {label}
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
