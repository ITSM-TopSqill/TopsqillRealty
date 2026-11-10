"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { alertHref } from "@/lib/alerts";
export { alertHref };

/**
 * Live badges and pop-up alerts on every page.
 *
 * One small poll (every 20 seconds while the tab is visible, and straight away
 * on navigation or when the tab regains focus) keeps the Messages and Alerts
 * counts current everywhere, and shows a pop-up when a new alert arrives.
 */
type Counts = { messages: number; notifications: number };
type Toast = { id: string; title: string; body?: string | null; href: string };

let counts: Counts | null = null;
let toasts: Toast[] = [];
let watermark = "";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };


type Latest = { id: string; title: string; body?: string | null; targetType?: string | null; targetId?: string | null; createdAt: string };

let inflight: Promise<void> | null = null;
/** Re-reads the counts now (also called after reading a chat or answering an invitation). */
export function refreshCounts() {
  inflight ??= (async () => {
    try {
      const [n, m, latest] = await Promise.all([
        clientApi<{ unread: number }>("/v1/notifications/unread"),
        clientApi<{ unread: number }>("/v1/conversations/unread"),
        clientApi<{ items: Latest[] }>("/v1/notifications/latest"),
      ]);
      counts = { notifications: n.unread, messages: m.unread };
      emit();
      popUp(latest.items);
    } catch { /* signed out or offline: keep the last numbers */ }
    finally { inflight = null; }
  })();
  return inflight;
}

/**
 * Pops up alerts newer than anything seen since the page opened. A chat's
 * alert is refreshed by each new message (its time moves forward), so new
 * messages pop up too. Older alerts that surface once others are read do not.
 */
function popUp(items: Latest[]) {
  const newest = items.reduce((m, i) => (i.createdAt > m ? i.createdAt : m), "");
  if (!watermark) { watermark = newest || new Date().toISOString(); return; }
  const fresh = items.filter((i) => i.createdAt > watermark);
  if (newest > watermark) watermark = newest;
  if (!fresh.length) return;
  const ids = new Set(fresh.map((i) => i.id));
  toasts = [...fresh.slice(0, 2).map((i) => ({ id: i.id, title: i.title, body: i.body, href: alertHref(i.targetType, i.targetId) })), ...toasts.filter((t) => !ids.has(t.id))].slice(0, 3);
  emit();
  for (const t of fresh) setTimeout(() => dismiss(t.id), 8000);
}
function dismiss(id: string) { toasts = toasts.filter((t) => t.id !== id); emit(); }

/** The number on a tab. Starts from what the server rendered, then stays live. */
export function LiveBadge({ kind, initial }: { kind: keyof Counts; initial?: number }) {
  const value = useSyncExternalStore(subscribe, () => counts?.[kind] ?? initial ?? 0, () => initial ?? 0);
  if (!value) return null;
  return <span className="badge-dot">{value > 9 ? "9+" : value}</span>;
}

/** The live count as a hook, for components that react to new messages or alerts. */
export function useLiveCount(kind: keyof Counts) {
  return useSyncExternalStore(subscribe, () => counts?.[kind] ?? 0, () => 0);
}

/** Runs the poll and shows pop-ups. Rendered once, by the page frame, for signed-in members. */
export function LiveAlerts() {
  const pathname = usePathname();
  const router = useRouter();
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts);

  useEffect(() => { refreshCounts(); }, [pathname]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") refreshCounts(); };
    const timer = setInterval(tick, 20_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
  }, []);

  if (!list.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast">
          <button className="toast-main" onClick={() => {
            dismiss(t.id);
            clientApi("/v1/notifications/read", { method: "POST", body: { ids: [t.id] } }).then(() => refreshCounts()).catch(() => {});
            router.push(t.href);
          }}>
            <span className="toast-ic" aria-hidden>🔔</span>
            <span style={{ minWidth: 0 }}>
              <b>{t.title}</b>
              {t.body ? <span className="small muted" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.body}</span> : null}
            </span>
          </button>
          <button className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

/** A small "Link" that marks an alert read when it is opened. */
export function AlertLink({ id, href, unread, children }: { id: string; href: string; unread: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className="row" style={{ flex: 1, textDecoration: "none" }} onClick={() => {
      if (unread) clientApi("/v1/notifications/read", { method: "POST", body: { ids: [id] } }).then(() => refreshCounts()).catch(() => {});
    }}>{children}</Link>
  );
}
