"use client";

import { useEffect, useRef, useState } from "react";
import { clientApi } from "@/lib/api";

type Account = { id: string; phoneNumberId: string; displayNumber: string | null; status: string } | null;
type Config = { configured: boolean; appId?: string; configId?: string };

declare global {
  interface Window {
    FB?: { init: (o: Record<string, unknown>) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void };
  }
}

let fbReady: Promise<void> | null = null;
/** Loads Meta's JS SDK once, however many times this is called. */
function loadFacebookSdk(appId: string): Promise<void> {
  if (window.FB) return Promise.resolve();
  fbReady ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.onload = () => { window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v23.0" }); resolve(); };
    document.body.appendChild(s);
  });
  return fbReady;
}

/**
 * Connects a dealer's own WhatsApp Business number via Meta's Embedded
 * Signup: a popup where they pick or create their number, no API keys ever
 * typed in. We get back a one-time code plus the new number's ids, and the
 * server exchanges that for a real token (see whatsapp.service.ts).
 */
export function WhatsAppBusinessConnect() {
  const [config, setConfig] = useState<Config | null>(null);
  const [account, setAccount] = useState<Account>(null);
  const [state, setState] = useState<"idle" | "opening" | "finishing" | "error">("idle");
  const [error, setError] = useState("");
  const picked = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  useEffect(() => {
    clientApi<Config>("/v1/whatsapp/embedded-config").then(setConfig).catch(() => setConfig({ configured: false }));
    clientApi<Account>("/v1/whatsapp/account").then(setAccount).catch(() => {});
  }, []);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!/\.facebook\.com$/.test(new URL(e.origin).hostname) && e.origin !== "https://www.facebook.com") return;
      try {
        const data = JSON.parse(String(e.data));
        if (data.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH" && data.data?.phone_number_id) {
          picked.current = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id };
        }
      } catch { /* not our message */ }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function connect() {
    if (!config?.configured) return;
    setState("opening"); setError(""); picked.current = {};
    try {
      await loadFacebookSdk(config.appId!);
      window.FB!.login((res) => {
        const code = res.authResponse?.code;
        if (!code) { setState("idle"); return; }
        setState("finishing");
        // Meta's postMessage with the chosen number's ids can arrive slightly
        // after this callback; give it a moment to land before giving up.
        setTimeout(async () => {
          const { wabaId, phoneNumberId } = picked.current;
          if (!wabaId || !phoneNumberId) { setError("Didn't get the number you picked. Please try again."); setState("error"); return; }
          try {
            const acc = await clientApi<Account>("/v1/whatsapp/embedded-callback", { method: "POST", body: { code, wabaId, phoneNumberId } });
            setAccount(acc); setState("idle");
          } catch (e) { setError((e as Error).message); setState("error"); }
        }, 1200);
      }, { config_id: config.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: "3" } });
    } catch { setError("Couldn't open Meta's connect window."); setState("error"); }
  }

  async function disconnect() {
    if (!confirm("Disconnect your WhatsApp Business number? You can reconnect any time.")) return;
    try { await clientApi("/v1/whatsapp", { method: "DELETE" }); setAccount(null); }
    catch (e) { setError((e as Error).message); }
  }

  if (!config) return null;

  return (
    <div className="card pad" style={{ marginBottom: 16 }}>
      <div className="spread" style={{ gap: 12, flexWrap: "wrap" }}>
        <div>
          <b>📟 Your WhatsApp Business number</b>
          <p className="small muted" style={{ margin: "2px 0 0" }}>
            {account ? "Message your leads straight from Topsqill, tracked here." : "Connect your own number to message leads from Topsqill, no app-switching."}
          </p>
        </div>
        {!config.configured ? (
          <span className="small muted">Not set up yet</span>
        ) : account ? (
          <div className="row" style={{ gap: 8 }}>
            <span className="tag" style={{ color: "var(--grn, #12B76A)" }}>✓ {account.displayNumber ?? account.phoneNumberId}</span>
            <button type="button" className="btn btn-g sm" onClick={disconnect}>Disconnect</button>
          </div>
        ) : (
          <button type="button" className="btn btn-ai" onClick={connect} disabled={state === "opening" || state === "finishing"}>
            {state === "opening" ? "Opening…" : state === "finishing" ? "Connecting…" : "Connect WhatsApp Business"}
          </button>
        )}
      </div>
      {error ? <p className="error small" role="alert" style={{ marginTop: 8 }}>{error}</p> : null}
    </div>
  );
}
