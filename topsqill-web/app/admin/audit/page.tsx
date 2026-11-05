import { api } from "@/lib/api";
import { getToken } from "@/lib/session";
import { Empty } from "@/components/ui";
import { timeAgo } from "@/lib/format";

type Entry = {
  id: string; actorId?: string | null; action: string;
  targetType?: string | null; targetId?: string | null;
  meta?: Record<string, unknown> | null; createdAt: string;
};

const LABEL: Record<string, string> = {
  "verification.approved": "Approved a verification",
  "verification.rejected": "Rejected a verification",
  "verification.info": "Asked for more information",
  "content.hidden": "Hid content",
  "content.restored": "Restored content",
  "member.suspended": "Suspended a member",
  "member.removed": "Removed a member",
  "member.active": "Reinstated a member",
};

export default async function AuditPage() {
  const token = await getToken();
  const log = await api<{ items: Entry[] }>("/v1/admin/audit", { token }).catch(() => ({ items: [] }));

  return (
    <>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Audit log</h1>
      <p className="muted small" style={{ marginBottom: 14 }}>Every admin action, with who did it and when.</p>

      {log.items.length ? (
        <div className="card" style={{ overflow: "hidden" }}>
          {log.items.map((e) => (
            <div key={e.id} className="row" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b className="small">{LABEL[e.action] ?? e.action}</b>
                <div className="small muted">
                  {e.targetType ? `${e.targetType} ${e.targetId?.slice(0, 8)}…` : ""}
                  {e.meta?.reason ? ` · ${String(e.meta.reason)}` : ""}
                </div>
              </div>
              <span className="small muted" style={{ whiteSpace: "nowrap" }}>{timeAgo(e.createdAt)}</span>
            </div>
          ))}
        </div>
      ) : <Empty title="Nothing recorded yet" text="Admin actions will be listed here." />}
    </>
  );
}
