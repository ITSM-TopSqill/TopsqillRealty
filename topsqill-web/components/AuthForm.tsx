"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthMethods } from "@/lib/auth-methods";

type Mode = "signin" | "signup";
type Channel = "email" | "phone";

const TYPES = [
  { value: "dealer", label: "Dealer", blurb: "I help people buy, sell and rent" },
  { value: "builder", label: "Builder", blurb: "I develop projects" },
  { value: "buyer", label: "Buyer", blurb: "I’m looking for a property" },
  { value: "seller", label: "Owner", blurb: "I want to sell or rent mine out" },
] as const;

/** Carries what was typed across Sign in ⇄ Sign up without putting it in the URL. */
const PREFILL = "tq_auth_prefill";

/**
 * Sign in and sign up, by email or mobile. The code goes to the API; the tokens
 * come back as httpOnly cookies set by our own route, so nothing sensitive
 * touches this component.
 *
 * Sign in: email or mobile → code → in.
 * Sign up: name, who you are, email or mobile → code → account created → onboarding.
 */
export function AuthForm({ mode, methods, next }: { mode: Mode; methods: AuthMethods; next: string | null }) {
  const router = useRouter();
  const available: Channel[] = (["email", "phone"] as const).filter((c) => methods[c]);
  const [channel, setChannel] = useState<Channel>(available[0] ?? "email");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("buyer");
  const [step, setStep] = useState<"start" | "code">("start");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [switchTo, setSwitchTo] = useState<Mode | null>(null);   // "no account" / "already exists"
  const [cooldown, setCooldown] = useState(0);

  // Pick up what the member typed on the other screen.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(PREFILL) ?? "null") as { channel: Channel; identifier: string } | null;
      if (saved && methods[saved.channel]) { setChannel(saved.channel); setIdentifier(saved.identifier); }
      sessionStorage.removeItem(PREFILL);
    } catch { /* storage blocked: start empty */ }
  }, [methods]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!available.length) {
    return <p className="error">Signing in is unavailable right now. Please try again shortly.</p>;
  }

  const isEmail = channel === "email";
  const idValid = isEmail ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(identifier.trim()) : identifier.replace(/\D/g, "").length >= 10;
  const detailsValid = mode === "signin" || name.trim().length >= 2;

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setError(""); setSwitchTo(null);
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, identifier: identifier.trim(), intent: mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (mode === "signin" && res.status === 404) setSwitchTo("signup");
        if (mode === "signup" && res.status === 409) setSwitchTo("signin");
        throw new Error(messageOf(data, "We couldn’t send the code. Please try again."));
      }
      setDevCode(data.devCode ?? null);      // only present outside production
      setStep("code"); setCode(""); setCooldown(30);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel, identifier: identifier.trim(), code, intent: mode,
          profile: mode === "signup" ? { name: name.trim(), type } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(messageOf(data, "That code isn’t right."));
      router.replace(data.isNew ? "/onboarding" : next ?? "/");
      router.refresh();
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  function goToOtherMode(target: Mode) {
    try { sessionStorage.setItem(PREFILL, JSON.stringify({ channel, identifier: identifier.trim() })); } catch { /* ignore */ }
    router.push(target === "signup" ? "/signup" : `/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }

  if (step === "code") {
    const where = isEmail ? identifier.trim().toLowerCase() : identifier;
    return (
      <form onSubmit={verify} className="col">
        <p className="small" style={{ margin: 0 }}>
          {isEmail ? "We’ve emailed a 6-digit code to " : "We’ve sent a 6-digit code to "}<b>{where}</b>.
          {isEmail ? " It can take a minute to arrive; check your spam folder too." : ""}
        </p>
        <div className="field">
          <label htmlFor="code">Enter the code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus
            maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            style={{ letterSpacing: "0.4em", fontSize: 20, textAlign: "center" }} />
        </div>
        {devCode ? <p className="small muted">Development mode: your code is <b>{devCode}</b></p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="btn btn-ai" disabled={busy || code.length < 6}>
          {busy ? "Checking…" : mode === "signup" ? "Create my account" : "Sign in"}
        </button>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button type="button" className="btn btn-g sm" onClick={() => { setStep("start"); setCode(""); setError(""); }}>
            {isEmail ? "Use a different email" : "Use a different number"}
          </button>
          <button type="button" className="btn btn-g sm" disabled={busy || cooldown > 0} onClick={() => sendCode()}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} className="col">
      {mode === "signup" ? (
        <>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" name="name" autoComplete="name" required autoFocus maxLength={120}
              placeholder="Riya Kapoor" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label id="type-label">I am a</label>
            <div role="radiogroup" aria-labelledby="type-label" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {TYPES.map((t) => (
                <button key={t.value} type="button" role="radio" aria-checked={type === t.value} onClick={() => setType(t.value)}
                  className="card" style={{ padding: "10px 12px", textAlign: "left", borderWidth: 2, borderColor: type === t.value ? "var(--vio)" : "var(--line)" }}>
                  <b style={{ fontSize: 14 }}>{t.label}</b>
                  <div className="small muted" style={{ lineHeight: 1.3 }}>{t.blurb}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {available.length > 1 ? (
        <div role="tablist" aria-label="How to receive your code" className="row" style={{ gap: 6 }}>
          {available.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={channel === c}
              className={`chip ${channel === c ? "on" : ""}`}
              onClick={() => { setChannel(c); setIdentifier(""); setError(""); setSwitchTo(null); }}>
              {c === "email" ? "Email" : "Mobile number"}
            </button>
          ))}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="identifier">{isEmail ? "Email address" : "Mobile number"}</label>
        {isEmail ? (
          <input key="email" id="identifier" name="email" type="email" autoComplete="email" required
            autoFocus={mode === "signin"} maxLength={160}
            placeholder="you@example.com" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        ) : (
          <input key="phone" id="identifier" name="phone" type="tel" inputMode="numeric" autoComplete="tel" required
            autoFocus={mode === "signin"} maxLength={16}
            placeholder="98765 43210" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        )}
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}{" "}
          {switchTo ? (
            <button type="button" className="linklike" onClick={() => goToOtherMode(switchTo)}>
              {switchTo === "signup" ? "Create an account" : "Sign in"}
            </button>
          ) : null}
        </p>
      ) : null}

      <button className="btn btn-ai" disabled={busy || !idValid || !detailsValid}>
        {busy ? "Sending…" : "Send code"}
      </button>

      <p className="small muted" style={{ textAlign: "center", margin: 0 }}>
        {mode === "signin" ? "New to Topsqill.ai? " : "Already have an account? "}
        <button type="button" className="linklike" onClick={() => goToOtherMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </form>
  );
}

function messageOf(data: unknown, fallback: string): string {
  const m = (data as { message?: string | string[] } | null)?.message;
  return (Array.isArray(m) ? m[0] : m) || fallback;
}
