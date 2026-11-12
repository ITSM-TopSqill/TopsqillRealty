import { describe, expect, it, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://x/y", JWT_SECRET: "x".repeat(40),
    WHATSAPP_TOKEN: "wa-token", WHATSAPP_PHONE_NUMBER_ID: "111", INSTAGRAM_APP_ID: "ig-app", INSTAGRAM_APP_SECRET: "ig-secret",
  });
});

import { flattenMedia } from "../src/integrations/instagram.service";
import { MediaInboxService } from "../src/integrations/media-inbox.service";

describe("Instagram picker", () => {
  it("turns posts, carousels and reels into single photos and videos", () => {
    const items = flattenMedia([
      { id: "1", media_type: "IMAGE", media_url: "https://cdn/1.jpg", caption: "Living room", permalink: "p1", timestamp: "t1" },
      { id: "2", media_type: "CAROUSEL_ALBUM", caption: "Tour", permalink: "p2", timestamp: "t2", children: { data: [
        { id: "2a", media_type: "IMAGE", media_url: "https://cdn/2a.jpg" }, { id: "2b", media_type: "VIDEO", media_url: "https://cdn/2b.mp4", thumbnail_url: "https://cdn/2b.jpg" }] } },
      { id: "3", media_type: "VIDEO", media_url: "https://cdn/3.mp4", thumbnail_url: "https://cdn/3.jpg" },
      { id: "4", media_type: "IMAGE" },
    ]);
    expect(items.map((i) => [i.id, i.type, i.thumb])).toEqual([
      ["1", "image", "https://cdn/1.jpg"], ["2a", "image", "https://cdn/2a.jpg"], ["2b", "video", "https://cdn/2b.jpg"], ["3", "video", "https://cdn/3.jpg"],
    ]);
    expect(items[1].caption).toBe("Tour");
  });
});

describe("WhatsApp media inbox", () => {
  const store = new Map<string, string>();
  const cache = { redis: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string, ..._a: unknown[]) => { if (_a.includes("NX") && store.has(k)) return null; store.set(k, v); return "OK"; },
    incr: async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; },
    expire: async () => 1,
  } };
  const memberPhone = "+919800000001";
  const read = { select: () => ({ from: () => ({ where: () => ({ limit: async () => (lastPhone === memberPhone ? [{ id: "u1", phone: memberPhone }] : []) }) }) }) };
  let lastPhone = "";
  const stored: { user: string; mime: string; source: string }[] = [];
  const mediaSvc = { storeOwn: async (user: string, _b: Buffer, mime: string, source: string) => { stored.push({ user, mime, source }); return { mediaId: "m1", kind: "image", status: "processing" }; } };
  const sent: string[] = [];

  beforeEach(() => {
    store.clear(); stored.length = 0; sent.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/messages")) { sent.push(JSON.parse(String(init?.body)).text.body); return new Response("{}"); }
      if (url.includes("graph.facebook.com/v23.0/media-1")) return new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/x", mime_type: "image/jpeg", file_size: 20000 }));
      if (url.startsWith("https://lookaside.fbsbx.com/")) return new Response(Buffer.alloc(20000));
      return new Response("{}", { status: 404 });
    }));
  });

  const svc = () => new MediaInboxService(read as never, mediaSvc as never, cache as never);
  const msg = (from: string, extra: Record<string, unknown>) => ({ metadata: { phone_number_id: "111" }, messages: [{ from: from.replace("+", ""), id: "w1", ...extra }] });

  it("knows its own number", () => {
    expect(svc().isOurNumber("111")).toBe(true);
    expect(svc().isOurNumber("222")).toBe(false);
  });

  it("saves a member's photo as their own media, and replies once", async () => {
    lastPhone = memberPhone;
    await svc().receive(msg(memberPhone, { type: "image", image: { id: "media-1" } }));
    await svc().receive(msg(memberPhone, { type: "image", image: { id: "media-1" } }));
    expect(stored).toEqual([{ user: "u1", mime: "image/jpeg", source: "whatsapp" }, { user: "u1", mime: "image/jpeg", source: "whatsapp" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/From WhatsApp/);
  });

  it("asks strangers to sign in first and saves nothing", async () => {
    lastPhone = "+919811111111";
    await svc().receive(msg("+919811111111", { type: "image", image: { id: "media-1" } }));
    expect(stored).toHaveLength(0);
    expect(sent[0]).toMatch(/sign in/i);
  });
});
