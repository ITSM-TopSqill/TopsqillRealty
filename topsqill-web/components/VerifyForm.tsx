"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { MediaUploader, type UploadedItem } from "./MediaUploader";

export type Request = { id: string; kind: string; status: string; note?: string | null; createdAt: string; reviewedAt?: string | null };

const STATUS: Record<string, [string, string]> = {
  pending: ["Under review", "#E08A00"], info: ["More information needed", "#2F7FE6"],
  approved: ["Approved", "#12B76A"], rejected: ["Not approved", "#E5484D"],
};
const DOCS = {
  kyc: [{ key: "PAN card", hint: "Front side, all four corners visible" }, { key: "Aadhaar card", hint: "Front and back, or the e-Aadhaar PDF" }],
  rera: [{ key: "RERA certificate", hint: "Your agent registration certificate" }],
};

export function VerifyForm({ requests, kyc, rera, dealer, reraNumber }: { requests: Request[]; kyc: boolean; rera: boolean; dealer: boolean; reraNumber: string }) {
  const router = useRouter();
  const open = (k: string) => requests.some((r) => r.kind === k && (r.status === "pending" || r.status === "info"));
  const firstKind: "kyc" | "rera" = !kyc && !open("kyc") ? "kyc" : "rera";
  const [kind, setKind] = useState<"kyc" | "rera">(firstKind);
  const [files, setFiles] = useState<Record<string, UploadedItem[]>>({});
  const [number, setNumber] = useState(reraNumber);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const done1 = kind === "kyc" ? kyc : rera;
  const docs = DOCS[kind];
  const uploading = Object.values(files).flat().some((f) => f.status === "uploading" || f.status === "processing");

  async function submit() {
    const documents = docs.flatMap((d) => (files[d.key] ?? []).filter((f) => f.status === "ready").map((f) => ({ label: d.key, mediaId: f.mediaId })));
    const missing = docs.filter((d) => !(files[d.key] ?? []).some((f) => f.status === "ready")).map((d) => d.key);
    if (missing.length) { setError(`Please upload: ${missing.join(", ")}.`); return; }
    if (kind === "rera" && !number.trim()) { setError("Enter your RERA registration number."); return; }
    setBusy(true); setError("");
    try {
      await clientApi("/v1/verifications", { method: "POST", body: { kind, documents, ...(kind === "rera" ? { reraNumber: number.trim() } : {}) } });
      setDone(true); setFiles({});
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="col">
      {requests.length ? (
        <div className="card pad">
          <h2 style={{ fontSize: 17, marginBottom: 8 }}>Your requests</h2>
          {requests.map((r) => {
            const [label, color] = STATUS[r.status] ?? [r.status, "#8D8AA3"];
            return (
              <div key={r.id} className="spread small" style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                <span><b>{r.kind === "rera" ? "RERA" : "KYC"}</b> · sent {timeAgo(r.createdAt)}{r.note ? <span className="muted"> · {r.note}</span> : null}</span>
                <span className="pill" style={{ background: `color-mix(in srgb,${color} 15%,transparent)`, color }}>{label}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {done ? (
        <div className="card pad" style={{ border: "2px solid #12B76A" }}>
          <b>✓ Sent for review.</b>
          <p className="small muted" style={{ margin: "4px 0 0" }}>We usually review within one working day. You will get an alert and an email when it is done.</p>
        </div>
      ) : null}

      <div className="card pad">
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <button className={`chip ${kind === "kyc" ? "on" : ""}`} onClick={() => setKind("kyc")} aria-pressed={kind === "kyc"}>Identity (KYC){kyc ? " ✓" : ""}</button>
          {dealer || rera ? <button className={`chip ${kind === "rera" ? "on" : ""}`} onClick={() => setKind("rera")} aria-pressed={kind === "rera"}>RERA agent{rera ? " ✓" : ""}</button> : null}
        </div>

        {done1 ? <p style={{ margin: 0 }}>✓ You are already {kind === "rera" ? "RERA" : "KYC"} verified.</p>
          : open(kind) ? <p style={{ margin: 0 }}>Your {kind === "rera" ? "RERA" : "KYC"} request is being reviewed. We will let you know soon.</p>
          : (
            <>
              {kind === "rera" ? (
                <div className="field" style={{ marginBottom: 14 }}><label htmlFor="rera">RERA registration number</label>
                  <input id="rera" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={64} placeholder="RC/HARERA/GGM/2024/1234" />
                </div>
              ) : null}
              <div className="col" style={{ gap: 14 }}>
                {docs.map((d) => (
                  <div key={d.key}>
                    <b className="small">{d.key}</b>
                    <MediaUploader privateFiles items={files[d.key] ?? []} onChange={(xs) => setFiles((f) => ({ ...f, [d.key]: xs }))}
                      max={2} accept="image/*,application/pdf" title={`Upload your ${d.key}`} hint={`${d.hint}. A clear photo or a PDF, up to 25 MB.`} />
                  </div>
                ))}
              </div>
              {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
                <button className="btn btn-ai" onClick={submit} disabled={busy || uploading}>{busy ? "Sending…" : uploading ? "Uploading…" : "Send for review"}</button>
              </div>
            </>
          )}
      </div>
    </div>
  );
}
