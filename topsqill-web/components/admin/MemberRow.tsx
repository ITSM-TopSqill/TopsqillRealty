"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { Avatar, TypePill } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { AdminMember } from "@/app/admin/members/page";

/** One member row, with the actions an admin actually needs. */
export function MemberRow({ member }: { member: AdminMember }) {
  const router = useRouter();
  const [status, setStatus] = useState(member.status);
  const [kyc, setKyc] = useState(member.kycVerified);
  const [rera, setRera] = useState(member.reraVerified);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function setMemberStatus(next: "active" | "suspended" | "removed") {
    const reason = next === "active" ? undefined : window.prompt(`Why are you ${next === "removed" ? "removing" : "suspending"} ${member.name}?`) ?? "";
    if (next !== "active" && !reason) return;
    setBusy(next); setError("");
    try {
      await clientApi(`/v1/admin/members/${member.id}/status`, { method: "POST", body: { status: next, reason } });
      setStatus(next);
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function toggleVerified(field: "kyc" | "rera", value: boolean) {
    setBusy(field); setError("");
    try {
      await clientApi(`/v1/admin/members/${member.id}/verify/${field}`, { method: "POST", body: { value } });
      field === "kyc" ? setKyc(value) : setRera(value);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="row" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", gap: 12, flexWrap: "wrap", opacity: status === "removed" ? .55 : 1 }}>
      <Avatar person={member} size={42} />
      <div style={{ flex: 1, minWidth: 180 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Link href={`/profile/${member.id}`} style={{ fontWeight: 800 }}>{member.name}</Link>
          <TypePill type={member.type} />
          {status !== "active" ? <span className="pill" style={{ ["--c" as string]: "#E5484D" }}>{status}</span> : null}
        </div>
        <div className="small muted">
          {[member.city, member.phone].filter(Boolean).join(" · ")} · joined {timeAgo(member.createdAt)}
        </div>
        <div className="small muted">{member.listingCount} listings · {member.connectionCount} connections</div>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className={`chip ${kyc ? "on" : ""}`} onClick={() => toggleVerified("kyc", !kyc)} disabled={busy !== null}>
          {kyc ? "✓ KYC" : "KYC"}
        </button>
        <button className={`chip ${rera ? "on" : ""}`} onClick={() => toggleVerified("rera", !rera)} disabled={busy !== null}>
          {rera ? "✓ RERA" : "RERA"}
        </button>
        {status === "active" ? (
          <button className="btn btn-g sm" style={{ color: "var(--amber)" }} onClick={() => setMemberStatus("suspended")} disabled={busy !== null}>
            Suspend
          </button>
        ) : (
          <button className="btn btn-o sm" onClick={() => setMemberStatus("active")} disabled={busy !== null}>Reinstate</button>
        )}
        {status !== "removed" ? (
          <button className="btn btn-g sm" style={{ color: "var(--red)" }} onClick={() => setMemberStatus("removed")} disabled={busy !== null}>
            Remove
          </button>
        ) : null}
      </div>
      {error ? <p className="error" style={{ width: "100%" }}>{error}</p> : null}
    </div>
  );
}
