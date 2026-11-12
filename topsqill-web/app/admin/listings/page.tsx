import Link from "next/link";
import { api } from "@/lib/api";
import { getToken } from "@/lib/session";
import { Empty } from "@/components/ui";
import { ListingReviewCard, type ReviewItem } from "@/components/admin/ListingReviewCard";
import { ApprovalMode } from "@/components/admin/ApprovalMode";

export const metadata = { title: "Listing reviews" };

type Queue = { counts: Record<string, number>; reasons: Record<string, string>; items: ReviewItem[] };
const TABS = [["pending", "Waiting"], ["changes", "Changes requested"], ["rejected", "Rejected"], ["approved", "Approved"]] as const;

/** Listings waiting for approval, with automatic checks, and the decisions made in the last 30 days. */
export default async function ListingReviews({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ status }, token] = await Promise.all([searchParams, getToken()]);
  const tab = TABS.some(([k]) => k === status) ? status! : "pending";
  const [q, settings] = await Promise.all([
    api<Queue>(`/v1/admin/listings?status=${tab}`, { token }).catch(() => ({ counts: {}, reasons: {}, items: [] }) as Queue),
    api<{ approval: "all" | "unverified" | "off" }>("/v1/admin/listings/settings", { token }).catch(() => ({ approval: "all" as const })),
  ]);
  return (
    <>
      <div className="spread" style={{ flexWrap: "wrap", gap: 12, marginBottom: 14, alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, marginBottom: 4 }}>Listing reviews</h1>
          <p className="muted small" style={{ margin: 0 }}>New listings wait here until approved. Owners are told the decision, with your reasons and note, in the app and by email.</p>
        </div>
        <ApprovalMode current={settings.approval} />
      </div>
      <nav className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }} aria-label="Review status">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/admin/listings${k === "pending" ? "" : `?status=${k}`}`} className={`chip${tab === k ? " on" : ""}`} aria-current={tab === k ? "page" : undefined}>
            {label}{q.counts?.[k] ? ` · ${q.counts[k]}` : ""}
          </Link>
        ))}
      </nav>
      {q.items.length
        ? <div className="col" style={{ gap: 14 }}>{q.items.map((it) => <ListingReviewCard key={it.reviewId} item={it} reasons={q.reasons} />)}</div>
        : <Empty title={tab === "pending" ? "Nothing waiting" : "Nothing here"} text={tab === "pending" ? "New and resubmitted listings appear here for review." : "Decisions from the last 30 days appear here."} />}
    </>
  );
}
