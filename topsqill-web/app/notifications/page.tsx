import { redirect } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { MarkAllRead } from "@/components/MarkAllRead";
import type { Notification, Paged } from "@/lib/types";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const LINK: Record<string, (id: string) => string> = {
  lead: (id) => `/leads?lead=${id}`,
  message: (id) => `/messages?c=${id}`,
  listing: (id) => `/listings/${id}`,
  conversation: (id) => `/messages?c=${id}`,
};

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
            const href = n.targetType && n.targetId ? LINK[n.targetType]?.(n.targetId) : undefined;
            const inner = (
              <>
                <div style={{ flex: 1 }}>
                  <b>{n.title}</b>
                  {n.body ? <div className="small muted">{n.body}</div> : null}
                  <div className="small muted">{timeAgo(n.createdAt)}</div>
                </div>
              </>
            );
            return (
              <div key={n.id} className="row" style={{
                padding: "14px 18px", borderTop: "1px solid var(--line)", gap: 12,
                background: n.readAt ? "transparent" : "color-mix(in srgb, var(--vio) 7%, var(--card))",
              }}>
                {href ? <Link href={href} className="row" style={{ flex: 1, textDecoration: "none" }}>{inner}</Link> : inner}
              </div>
            );
          })}
        </div>
      ) : <Empty title="Nothing here yet" text="When people connect, message you or send a lead, it shows up here." />}
    </Shell>
  );
}
