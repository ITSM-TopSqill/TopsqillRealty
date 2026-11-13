/**
 * Sends push notifications to the mobile app. Two kinds of device token are
 * understood:
 *  - Expo tokens ("ExponentPushToken[...]"), sent through Expo's push service,
 *    which needs no key;
 *  - Firebase (FCM) tokens, sent with FCM's HTTP v1 API. On Cloud Run the
 *    service account's own access token is used, so no key file is stored;
 *    FCM_PROJECT_ID names the Firebase project. Without it, FCM is skipped.
 * Tokens the services report as gone are returned so the caller can drop them.
 */
export type PushMessage = { title: string; body?: string | null; url: string; data?: Record<string, string> };
export type PushResult = { sent: number; dead: string[]; skipped: number };

const isExpo = (t: string) => /^Expo(nent)?PushToken\[.+\]$/.test(t);

let cached: { token: string; until: number } | null = null;
async function googleAccessToken(): Promise<string | null> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  if (process.env.FCM_ACCESS_TOKEN) return process.env.FCM_ACCESS_TOKEN;   // local testing only
  try {
    const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/firebase.messaging,https://www.googleapis.com/auth/cloud-platform",
      { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const j = await res.json() as { access_token: string; expires_in: number };
    cached = { token: j.access_token, until: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  } catch { return null; }
}

async function sendExpo(tokens: string[], m: PushMessage, res: PushResult) {
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    const r = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(batch.map((to) => ({ to, title: m.title, body: m.body ?? undefined, sound: "default", data: { url: m.url, ...m.data } }))),
    });
    if (!r.ok) throw new Error(`Expo push ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json() as { data?: { status: string; details?: { error?: string } }[] };
    (j.data ?? []).forEach((t, k) => {
      if (t.status === "ok") res.sent++;
      else if (t.details?.error === "DeviceNotRegistered") res.dead.push(batch[k]);
    });
  }
}

async function sendFcm(tokens: string[], m: PushMessage, res: PushResult) {
  const project = process.env.FCM_PROJECT_ID;
  const access = project ? await googleAccessToken() : null;
  if (!project || !access) { res.skipped += tokens.length; return; }
  for (const token of tokens) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
      body: JSON.stringify({ message: {
        token, notification: { title: m.title, body: m.body ?? undefined },
        data: { url: m.url, ...m.data },
        android: { priority: "high", notification: { sound: "default" } },
        apns: { payload: { aps: { sound: "default" } } },
      } }),
    });
    if (r.ok) { res.sent++; continue; }
    const text = await r.text();
    if (r.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) { res.dead.push(token); continue; }
    if (r.status === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text)) { res.dead.push(token); continue; }
    throw new Error(`FCM ${r.status}: ${text.slice(0, 200)}`);
  }
}

export async function sendPush(tokens: string[], m: PushMessage): Promise<PushResult> {
  const res: PushResult = { sent: 0, dead: [], skipped: 0 };
  const expo = tokens.filter(isExpo), fcm = tokens.filter((t) => !isExpo(t));
  if (expo.length) await sendExpo(expo, m, res);
  if (fcm.length) await sendFcm(fcm, m, res);
  return res;
}
