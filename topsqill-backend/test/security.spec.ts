/**
 * Regression tests for the access-control and webhook fixes.
 * Each one pins a hole that used to be open, without needing a database.
 */
import { describe, it, expect, vi } from "vitest";

// Services import the Redis and queue modules, which connect on import. These
// tests hand every dependency in directly, so stand-ins are enough.
vi.mock("../src/redis/redis.module", () => ({ REDIS: Symbol("REDIS"), CacheService: class {} }));
vi.mock("../src/queue/queue.module", () => ({ QUEUES: { media: "media", ai: "ai", fanout: "fanout", notify: "notify" }, QueueService: class {} }));
import { createHmac } from "node:crypto";
import { verifyMetaSignature } from "../src/common/meta-signature";
import { clientIp } from "../src/common/client-ip";

const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("Meta webhook signatures", () => {
  const body = '{"entry":[{"changes":[{"value":{"leadgen_id":"1"}}]}]}';

  it("accepts a signature over the exact raw bytes", () => {
    expect(verifyMetaSignature(Buffer.from(body), sign(body, "s3cret"), "s3cret", true)).toEqual({ ok: true });
  });

  it("rejects a body that differs from what was signed, even only in whitespace", () => {
    const reserialised = JSON.stringify(JSON.parse(body), null, 1);
    expect(verifyMetaSignature(Buffer.from(reserialised), sign(body, "s3cret"), "s3cret", true).ok).toBe(false);
  });

  it("rejects missing or wrong signatures", () => {
    expect(verifyMetaSignature(Buffer.from(body), undefined, "s3cret", true).ok).toBe(false);
    expect(verifyMetaSignature(Buffer.from(body), sign(body, "other"), "s3cret", true).ok).toBe(false);
    expect(verifyMetaSignature(undefined, sign(body, "s3cret"), "s3cret", true).ok).toBe(false);
  });

  it("fails closed in production when no secret is configured, but not in development", () => {
    expect(verifyMetaSignature(Buffer.from(body), undefined, undefined, true).ok).toBe(false);
    expect(verifyMetaSignature(Buffer.from(body), undefined, undefined, false).ok).toBe(true);
  });
});

describe("client IP for rate limits", () => {
  const secret = "a-shared-proxy-secret-1234";

  it("ignores a client-supplied forwarded header and uses the proxy-derived ip", () => {
    const req = { ip: "203.0.113.9", headers: { "x-forwarded-for": "1.2.3.4" } };
    expect(clientIp(req, secret)).toBe("203.0.113.9");
  });

  it("trusts the web server's visitor header only with the shared secret", () => {
    const headers = { "x-topsqill-client-ip": "198.51.100.7", "x-topsqill-proxy-key": secret };
    expect(clientIp({ ip: "10.0.0.5", headers }, secret)).toBe("198.51.100.7");
    expect(clientIp({ ip: "10.0.0.5", headers: { ...headers, "x-topsqill-proxy-key": "guess" } }, secret)).toBe("10.0.0.5");
    expect(clientIp({ ip: "10.0.0.5", headers }, undefined)).toBe("10.0.0.5");
  });

  it("refuses a visitor header that is not an IP address", () => {
    const headers = { "x-topsqill-client-ip": "evil key with spaces", "x-topsqill-proxy-key": secret };
    expect(clientIp({ ip: "10.0.0.5", headers }, secret)).toBe("10.0.0.5");
  });
});

describe("listing edits", () => {
  it("only writes fields an owner may change", async () => {
    const { ListingsService } = await import("../src/listings/listings.service");
    let written: Record<string, unknown> = {};
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ownerId: "u1", publishedAt: new Date() }] }) }) }),
      update: () => ({ set: (d: Record<string, unknown>) => { written = d; return { where: () => ({ returning: async () => [d] }) }; } }),
    };
    const cache = { invalidate: async () => {} };
    const svc = new ListingsService(db as never, db as never, cache as never, {} as never, {} as never);
    await svc.update("u1", "l1", {
      title: "New title", priceInr: 9_000_000,
      verified: true, hidden: false, ownerId: "attacker", viewCount: 99999,
    } as never);
    expect(written.title).toBe("New title");
    expect(written.priceInr).toBe(9_000_000);
    for (const k of ["verified", "hidden", "ownerId", "viewCount"]) expect(written).not.toHaveProperty(k);
  });
});

describe("WhatsApp number ownership", () => {
  it("refuses to connect a number that belongs to another member, before storing any token", async () => {
    const { WhatsAppService } = await import("../src/integrations/whatsapp.service");
    let stored = false;
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ownerId: "someone-else" }] }) }) }) };
    const secrets = { put: async () => { stored = true; return "ref"; } };
    const svc = new WhatsAppService(db as never, db as never, secrets as never, {} as never);
    await expect(svc.connect("u1", { wabaId: "w", phoneNumberId: "p1", token: "t" })).rejects.toThrow(/already connected/);
    expect(stored).toBe(false);
  });
});

describe("connection requests", () => {
  it("cannot be accepted when there is no pending request from that member", async () => {
    const { ProfilesService } = await import("../src/profiles/profiles.service");
    let countsBumped = false;
    const tx = {
      update: (table: unknown) => ({
        set: (d: Record<string, unknown>) => {
          if ("connectionCount" in d) countsBumped = true;
          return { where: () => ({ returning: async () => [], then: (r: (v: unknown) => void) => r([]) }) };
        },
      }),
    };
    const db = { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
    const svc = new ProfilesService(db as never, db as never, { invalidate: async () => {} } as never, {} as never);
    await expect(svc.respond("u1", "u2", true)).rejects.toThrow(/no pending request/i);
    expect(countsBumped).toBe(false);
  });
});

describe("profile saves", () => {
  /** A member who joined by email; `written` captures what the save would store. */
  async function setup() {
    const { ProfilesService } = await import("../src/profiles/profiles.service");
    let written: Record<string, unknown> | null = null;
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ email: "aman@example.com", emailVerified: true, phone: null }] }) }) }),
      update: () => ({ set: (d: Record<string, unknown>) => { written = d; return { where: async () => [] }; } }),
    };
    const svc = new ProfilesService(db as never, db as never, { invalidate: async () => {} } as never, {} as never);
    svc.getProfile = (async () => ({})) as never;
    return { svc, written: () => written };
  }

  it("ignores fields the form did not send, as a validated DTO carries them all as undefined", async () => {
    const { svc, written } = await setup();
    // What the validation pipe hands over: every declared field present, most undefined.
    const dto = { name: "Aman Gupta", type: "builder", city: "Noida", localities: undefined, headline: "Hi", about: "About",
      agency: undefined, yearsExperience: undefined, reraNumber: undefined, avatarMediaId: undefined, coverMediaId: undefined, email: undefined };
    await expect(svc.updateMe("u2", dto as never)).resolves.toBeDefined();
    expect(written()).toMatchObject({ name: "Aman Gupta", type: "builder" });
    expect(written()).not.toHaveProperty("email");
    expect(written()).not.toHaveProperty("reraVerified");      // untouched RERA stays verified
  });

  it("still refuses to change the email an email-only member signs in with", async () => {
    const { svc } = await setup();
    await expect(svc.updateMe("u2", { email: "other@example.com" } as never)).rejects.toThrow(/sign in with this email/);
  });
});
