/**
 * Email sign-in and sign-up, with Redis and the database replaced by small
 * in-memory fakes so every rule can be checked without real services.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { normaliseEmail, renderCodeEmail } from "../src/auth/email";

vi.mock("../src/redis/redis.module", () => ({ REDIS: Symbol("REDIS"), CacheService: class {} }));

describe("email addresses", () => {
  it("normalises case and spaces and rejects junk", () => {
    expect(normaliseEmail("  Riya.Kapoor@Example.COM ")).toBe("riya.kapoor@example.com");
    for (const bad of ["", "riya", "riya@", "@example.com", "riya@example", "ri ya@example.com", "a@b.c"]) {
      expect(normaliseEmail(bad)).toBeNull();
    }
  });
});

describe("code email", () => {
  it("carries the code in the subject, text and HTML, with the expiry", () => {
    const m = renderCodeEmail({ code: "482913", intent: "signin", minutes: 5 });
    expect(m.subject).toBe("482913 is your Topsqill.ai sign-in code");
    expect(m.text).toContain("482913");
    expect(m.text).toContain("5 minutes");
    for (const d of "482913") expect(m.html).toContain(`>${d}</div>`);
  });

  it("says sign-up when creating an account and escapes the member's name", () => {
    const m = renderCodeEmail({ code: "111222", intent: "signup", minutes: 5, name: "<b>Riya</b> Kapoor" });
    expect(m.subject).toContain("sign-up code");
    expect(m.html).toContain("finish creating your Topsqill.ai account");
    expect(m.html).not.toContain("<b>Riya</b>");
    expect(m.html).toContain("&lt;b&gt;Riya&lt;/b&gt;");
  });
});

/* ------------------------------- fakes ------------------------------- */

function fakeRedis() {
  const kv = new Map<string, string>();
  const r = {
    kv,
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: string) => { kv.set(k, String(v)); return "OK"; },
    incr: async (k: string) => { const n = Number(kv.get(k) ?? 0) + 1; kv.set(k, String(n)); return n; },
    expire: async () => 1,
    del: async (...keys: string[]) => keys.reduce((n, k) => n + (kv.delete(k) ? 1 : 0), 0),
    multi: () => {
      const ops: (() => Promise<unknown>)[] = [];
      const m = {
        set: (k: string, v: string) => { ops.push(() => r.set(k, v)); return m; },
        del: (k: string) => { ops.push(() => r.del(k)); return m; },
        exec: async () => { for (const op of ops) await op(); return []; },
      };
      return m;
    },
  };
  return r;
}

/** `existing` is what an account lookup returns; inserts are recorded. */
function fakeDb(existing: Record<string, unknown> | null) {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (existing ? [existing] : []) }) }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        const row = { isAdmin: false, ...v };
        return Object.assign(Promise.resolve(), { returning: async () => [row] });
      },
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
}

async function makeService(opts: { existing?: Record<string, unknown> | null; prod?: boolean; smtp?: boolean } = {}) {
  vi.resetModules();
  process.env.NODE_ENV = opts.prod ? "production" : "test";
  process.env.DATABASE_URL = "postgres://x@localhost/x";
  process.env.JWT_SECRET = "test-secret-at-least-16";
  const { AuthService } = await import("../src/auth/auth.service");
  const redis = fakeRedis();
  const db = fakeDb(opts.existing ?? null);
  const sent: { to: string; subject: string }[] = [];
  const mailer = { configured: !!opts.smtp, send: async (to: string, m: { subject: string }) => { sent.push({ to, subject: m.subject }); } };
  const svc = new AuthService(db as never, redis as never, new JwtService({ secret: "test-secret-at-least-16" }), mailer as never);
  return { svc, redis, db, sent };
}

const member = { id: "u1", name: "Riya Kapoor", type: "dealer", city: "Noida", status: "active", isAdmin: false, email: "riya@example.com", emailVerified: true };

describe("email sign-in and sign-up", () => {
  beforeEach(() => { delete process.env.NODE_ENV; });

  it("signs an existing member in with an emailed code", async () => {
    const { svc, sent } = await makeService({ existing: member, smtp: true });
    const res = await svc.requestCode({ channel: "email", identifier: " Riya@Example.com", intent: "signin", ip: "1.1.1.1" });
    expect(sent).toEqual([{ to: "riya@example.com", subject: `${res.devCode} is your Topsqill.ai sign-in code` }]);
    const out = await svc.verifyCode({ channel: "email", identifier: "riya@example.com", code: res.devCode!, intent: "signin" });
    expect(out.isNew).toBe(false);
    expect(out.user.id).toBe("u1");
    expect(out.accessToken).toBeTruthy();
  });

  it("tells someone without an account to sign up, and sends nothing", async () => {
    const { svc, redis, sent } = await makeService({ existing: null, smtp: true });
    await expect(svc.requestCode({ channel: "email", identifier: "new@example.com", intent: "signin", ip: "1.1.1.1" }))
      .rejects.toMatchObject({ status: 404 });
    expect(sent).toHaveLength(0);
    expect(redis.kv.has("otp:e:new@example.com")).toBe(false);
  });

  it("refuses to sign up an address that already has an account", async () => {
    const { svc } = await makeService({ existing: member });
    await expect(svc.requestCode({ channel: "email", identifier: "riya@example.com", intent: "signup", ip: "1.1.1.1" }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("creates the account with the sign-up details and a verified email", async () => {
    const { svc, db } = await makeService({ existing: null });
    const { devCode } = await svc.requestCode({ channel: "email", identifier: "Aman@Example.com", intent: "signup", ip: "1.1.1.1" });
    const out = await svc.verifyCode({
      channel: "email", identifier: "aman@example.com", code: devCode!, intent: "signup",
      profile: { name: "Aman Gupta", type: "builder" },
    });
    expect(out.isNew).toBe(true);
    const user = db.inserted.find((r) => "emailVerified" in r)!;
    expect(user).toMatchObject({ email: "aman@example.com", emailVerified: true, phone: null, name: "Aman Gupta", type: "builder", status: "active" });
  });

  it("requires a name to sign up", async () => {
    const { svc } = await makeService({ existing: null });
    const { devCode } = await svc.requestCode({ channel: "email", identifier: "a@example.com", intent: "signup", ip: "1.1.1.1" });
    await expect(svc.verifyCode({ channel: "email", identifier: "a@example.com", code: devCode!, intent: "signup" }))
      .rejects.toThrow(/full name/);
  });

  it("locks the code after five wrong attempts", async () => {
    const { svc } = await makeService({ existing: member });
    const { devCode } = await svc.requestCode({ channel: "email", identifier: "riya@example.com", intent: "signin", ip: "1.1.1.1" });
    const wrong = devCode === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) {
      await expect(svc.verifyCode({ channel: "email", identifier: "riya@example.com", code: wrong, intent: "signin" })).rejects.toMatchObject({ status: 400 });
    }
    await expect(svc.verifyCode({ channel: "email", identifier: "riya@example.com", code: devCode!, intent: "signin" })).rejects.toMatchObject({ status: 429 });
  });

  it("uses each code once", async () => {
    const { svc } = await makeService({ existing: member });
    const { devCode } = await svc.requestCode({ channel: "email", identifier: "riya@example.com", intent: "signin", ip: "1.1.1.1" });
    await svc.verifyCode({ channel: "email", identifier: "riya@example.com", code: devCode!, intent: "signin" });
    await expect(svc.verifyCode({ channel: "email", identifier: "riya@example.com", code: devCode!, intent: "signin" })).rejects.toThrow(/expired/);
  });

  it("in production, offers only methods that can deliver, and never returns the code", async () => {
    const off = await makeService({ existing: member, prod: true, smtp: false });
    expect(off.svc.methods()).toEqual({ phone: false, email: false });
    await expect(off.svc.requestCode({ channel: "email", identifier: "riya@example.com", intent: "signin", ip: "1.1.1.1" }))
      .rejects.toMatchObject({ status: 503 });

    const on = await makeService({ existing: member, prod: true, smtp: true });
    expect(on.svc.methods().email).toBe(true);
    const res = await on.svc.requestCode({ channel: "email", identifier: "riya@example.com", intent: "signin", ip: "1.1.1.1" });
    expect(res.devCode).toBeUndefined();
    expect(on.sent).toHaveLength(1);
  });
});

describe("refreshing a session", () => {
  /** One refresh token, as the database would hold it, with an atomic "revoke if not yet revoked". */
  async function setup(revokedAt: Date | null = null) {
    vi.resetModules();
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres://x@localhost/x";
    process.env.JWT_SECRET = "test-secret-at-least-16";
    const { AuthService } = await import("../src/auth/auth.service");
    const token = { id: "rt1", userId: "u1", revokedAt };
    const db = {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => {
        if (token.revokedAt) return [];
        token.revokedAt = new Date();
        await new Promise((r) => setTimeout(r, 20));        // the winner is still working when siblings arrive
        return [token];
      } }) }) }),
      // select({ revokedAt }) reads the token; select() reads the member.
      select: (cols?: unknown) => ({ from: () => ({ where: () => ({ limit: async () => (cols ? [{ revokedAt: token.revokedAt }] : [member]) }) }) }),
      insert: () => ({ values: () => Promise.resolve() }),
    };
    const svc = new AuthService(db as never, fakeRedis() as never, new JwtService({ secret: "test-secret-at-least-16" }), {} as never);
    return svc;
  }

  it("gives parallel requests with the same token the same new session instead of signing the member out", async () => {
    const svc = await setup();
    const results = await Promise.all([svc.refresh("old"), svc.refresh("old"), svc.refresh("old")]);
    expect(new Set(results.map((r) => r.refreshToken)).size).toBe(1);
    expect(results[0].accessToken).toBeTruthy();
  });

  it("refuses a token that was rotated long ago", async () => {
    const svc = await setup(new Date(Date.now() - 10 * 60_000));
    await expect(svc.refresh("old")).rejects.toThrow(/sign in again/);
  });
});
