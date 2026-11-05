"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Phone sign-in. The code goes to the API; the tokens come back as httpOnly
 * cookies set by our own route, so nothing sensitive touches this component.
 */
export function SignInForm() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "We couldn’t send the code. Please try again.");
      setDevCode(data.devCode ?? null);      // only present outside production
      setStep("code");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "That code isn’t right.");
      router.replace(data.isNew ? "/onboarding" : "/");
      router.refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  if (step === "phone") {
    return (
      <form onSubmit={sendCode} className="col">
        <div className="field">
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" required autoFocus
            placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn btn-ai" disabled={busy || phone.replace(/\D/g, "").length < 10}>
          {busy ? "Sending…" : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="col">
      <div className="field">
        <label htmlFor="code">Enter the 6-digit code sent to {phone}</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus
          maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          style={{ letterSpacing: "0.4em", fontSize: 20, textAlign: "center" }} />
      </div>
      {devCode ? <p className="small muted">Development mode: your code is <b>{devCode}</b></p> : null}
      {error ? <p className="error">{error}</p> : null}
      <button className="btn btn-ai" disabled={busy || code.length < 4}>{busy ? "Checking…" : "Sign in"}</button>
      <button type="button" className="btn btn-g sm" onClick={() => { setStep("phone"); setCode(""); setError(""); }}>
        Use a different number
      </button>
    </form>
  );
}
