import { describe, it, expect, afterEach } from "vitest";
import { wantsAlert, cleanPrefs, fullPrefs, unsubscribeSig, checkUnsubscribeSig, isUnsubscribeKind } from "../src/notifications/alert-prefs";
import { renderAlertEmail } from "../src/notifications/alert-email";
import { sendPush } from "../worker/push";

describe("alert settings", () => {
  it("treats every kind as on until switched off", () => {
    expect(wantsAlert({}, "email", "message")).toBe(true);
    expect(wantsAlert({ email: { message: false } }, "email", "message")).toBe(false);
    expect(wantsAlert({ email: { message: false } }, "push", "message")).toBe(true);
  });
  it("never lets account notices be switched off", () => {
    expect(wantsAlert({ email: { system: false } }, "email", "system")).toBe(true);
  });
  it("drops unknown kinds and non-boolean values", () => {
    expect(cleanPrefs({ email: { message: false, system: false, hack: true, lead: "no" }, push: null, other: {} })).toEqual({ email: { message: false }, push: {} });
  });
  it("lists every kind for the settings page", () => {
    const rows = fullPrefs({ push: { lead: false } });
    expect(rows.find((r) => r.kind === "lead")).toMatchObject({ email: true, push: false });
  });
});

describe("unsubscribe links", () => {
  const secret = "test-secret-1234567890";
  it("accepts only the signature for that member and that kind", () => {
    const sig = unsubscribeSig(secret, "u1", "message");
    expect(checkUnsubscribeSig(secret, "u1", "message", sig)).toBe(true);
    expect(checkUnsubscribeSig(secret, "u2", "message", sig)).toBe(false);
    expect(checkUnsubscribeSig(secret, "u1", "all", sig)).toBe(false);
    expect(checkUnsubscribeSig(secret, "u1", "message", "")).toBe(false);
  });
  it("knows which kinds can be unsubscribed", () => {
    expect(isUnsubscribeKind("all")).toBe(true);
    expect(isUnsubscribeKind("system")).toBe(false);
  });
  it("puts the links in the email", () => {
    const m = renderAlertEmail({ kind: "message", title: "New message", url: "https://x/m", unsubscribeUrl: "https://x/unsubscribe?u=1", settingsUrl: "https://x/settings/alerts" });
    expect(m.html).toContain("Stop these emails");
    expect(m.text).toContain("https://x/settings/alerts");
  });
});

describe("push", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.FCM_PROJECT_ID; delete process.env.FCM_ACCESS_TOKEN; });

  it("sends Expo tokens through Expo and reports tokens that are gone", async () => {
    const seen: unknown[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] });
    }) as typeof fetch;
    const res = await sendPush(["ExponentPushToken[a]", "ExponentPushToken[b]"], { title: "Hi", body: "There", url: "https://x/m" });
    expect(res).toEqual({ sent: 1, dead: ["ExponentPushToken[b]"], skipped: 0 });
    expect((seen[0] as { url: string }).url).toContain("exp.host");
  });

  it("skips Firebase tokens until a Firebase project is set", async () => {
    globalThis.fetch = (async () => { throw new Error("should not call"); }) as typeof fetch;
    const res = await sendPush(["fcm-token-1"], { title: "Hi", url: "https://x" });
    expect(res).toEqual({ sent: 0, dead: [], skipped: 1 });
  });

  it("sends Firebase tokens with FCM v1 and drops unregistered ones", async () => {
    process.env.FCM_PROJECT_ID = "proj"; process.env.FCM_ACCESS_TOKEN = "tok";
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return urls.length === 1 ? Response.json({ name: "m1" }) : new Response(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), { status: 404 });
    }) as typeof fetch;
    const res = await sendPush(["good", "old"], { title: "Hi", url: "https://x" });
    expect(urls[0]).toBe("https://fcm.googleapis.com/v1/projects/proj/messages:send");
    expect(res).toEqual({ sent: 1, dead: ["old"], skipped: 0 });
  });
});
