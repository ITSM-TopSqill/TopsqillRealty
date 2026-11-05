import { api } from "@/lib/api";
import { getToken } from "@/lib/session";
import { Empty } from "@/components/ui";
import { ApprovalCard } from "@/components/admin/ApprovalCard";

export type Verification = {
  id: string; kind: string; status: string; risk?: string | null; riskScore?: number | null;
  aiChecks?: { label: string; ok: boolean }[] | null; aiNote?: string | null;
  documents: string[]; createdAt: string;
  userId: string; name: string; type: string; city?: string | null;
  phone?: string | null; email?: string | null; reraNumber?: string | null; agency?: string | null;
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ status }, token] = await Promise.all([searchParams, getToken()]);
  const queue = await api<{ items: Verification[] }>(`/v1/admin/verifications?status=${status ?? "pending"}`, { token })
    .catch(() => ({ items: [] }));

  return (
    <>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Approvals</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>
        KYC and RERA checks. Run the risk review first; it checks documents, RERA format, duplicate numbers and the email domain.
      </p>

      {queue.items.length ? (
        <div className="col">
          {queue.items.map((v) => <ApprovalCard key={v.id} verification={v} />)}
        </div>
      ) : (
        <Empty title="Nothing waiting" text="New verification requests appear here as members submit them." />
      )}
    </>
  );
}
