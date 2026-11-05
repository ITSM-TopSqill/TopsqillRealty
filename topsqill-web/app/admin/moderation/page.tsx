import { api } from "@/lib/api";
import { getToken } from "@/lib/session";
import { Empty } from "@/components/ui";
import { ReportCard } from "@/components/admin/ReportCard";
import Link from "next/link";

export type Report = {
  id: string; targetType: string; targetId: string; reason: string; detail?: string | null;
  status: string; aiConfidence?: number | null; aiReason?: string | null; createdAt: string;
  target?: { id: string; body?: string; title?: string; hidden?: boolean; authorId?: string; ownerId?: string } | null;
};

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ status }, token] = await Promise.all([searchParams, getToken()]);
  const current = status ?? "open";
  const reports = await api<{ items: Report[] }>(`/v1/admin/reports?status=${current}`, { token })
    .catch(() => ({ items: [] }));

  return (
    <>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Moderation</h1>
      <p className="muted small" style={{ marginBottom: 14 }}>
        Reported posts, comments and listings. Hiding is reversible; nothing is deleted.
      </p>

      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        {["open", "actioned", "dismissed"].map((s) => (
          <Link key={s} href={`/admin/moderation?status=${s}`} className={`chip ${current === s ? "on" : ""}`}>
            {s[0].toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>

      {reports.items.length
        ? <div className="col">{reports.items.map((r) => <ReportCard key={r.id} report={r} />)}</div>
        : <Empty title="Nothing to review" text="Reports from members and automatic checks appear here." />}
    </>
  );
}
