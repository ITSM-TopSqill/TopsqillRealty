"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

export function ImportProject({ initialUrl = "" }: { initialUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() && text.trim().length < 40) { setError("Paste the project’s link, or its brochure text."); return; }
    setBusy(true); setError("");
    try {
      const p = await clientApi<{ id: string }>("/v1/ai/projects/import", {
        method: "POST", body: { url: url.trim() || undefined, text: text.trim() || undefined },
      });
      router.push(`/projects/${p.id}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <form className="card pad" onSubmit={run}>
      <div className="field"><label htmlFor="url">Project link</label>
        <input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://builder.com/projects/sky-gardens" />
      </div>
      <div className="field" style={{ marginTop: 12 }}><label htmlFor="text">Page or brochure text (optional)</label>
        <textarea id="text" rows={10} value={text} onChange={(e) => setText(e.target.value)} maxLength={60000}
          placeholder="We read the link ourselves. If the site won’t open for us, or you have a brochure, paste its text here (Ctrl+A, copy, paste)." />
      </div>
      {error ? <p className="error" style={{ marginTop: 10 }}>{error}</p> : null}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn btn-ai" disabled={busy}>{busy ? "Reading the project…" : "✨ Build the project page"}</button>
      </div>
    </form>
  );
}
