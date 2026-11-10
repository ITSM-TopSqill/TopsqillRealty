import { redirect } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { MarkAllRead } from "@/components/MarkAllRead";
import { AlertLink } from "@/components/Live";
import { alertHref } from "@/lib/alerts";
import type { Notification, Paged } from "@/lib/types";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const ICON: Record<string, string> = { connection: "👥", message: "💬", lead: "🎯", match: "🏠", post: "👍", comment: "💬", job: "💼", system: "🛡" };

export default async function NotificationsPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin");

  const list = await api<Paged<Notification>>("/v1/notifications?limit=40", { token })
    .catch(() => ({ items: [], nextCursor: null }));

  return (
    <Shell user={user} current="/notifications">
      <div className="spread" style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 26 }}>Notifications</h1>
        <MarkAllRead />
      </div>

      {list.items.length ? (
        <div className="card" style={{ overflow: "hidden" }}>
          {list.items.map((n) => {
            const inner = (
              <>
                <span aria-hidden style={{ width: 38, height: 38, borderRadius: 12, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none", fontSize: 17 }}>{ICON[n.kind] ?? "🔔"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{n.title}</b>
                  {n.body ? <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{n.body}</div> : null}
                  <div className="small muted">{timeAgo(n.createdAt)}</div>
                </div>
                {!n.readAt ? <span aria-label="Unread" style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--vio)", flex: "none", alignSelf: "center" }} /> : null}
              </>
            );
            return (
              <div key={n.id} className="row" style={{
                padding: "14px 18px", borderTop: "1px solid var(--line)", gap: 12,
                background: n.readAt ? "transparent" : "color-mix(in srgb, var(--vio) 7%, var(--card))",
              }}>
                <AlertLink id={n.id} href={alertHref(n.targetType, n.targetId)} unread={!n.readAt}>{inner}</AlertLink>
              </div>
            );
          })}
        </div>
      ) : <Empty title="Nothing here yet" text="When people connect, message you or send a lead, it shows up here." />}
    </Shell>
  );
}
