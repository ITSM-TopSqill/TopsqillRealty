import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { PROVIDER_CAPABILITIES, providerById } from "../src/integrations/provider-capabilities";

describe("provider capability data", () => {
  it("has no duplicate provider ids", () => {
    const ids = PROVIDER_CAPABILITIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks every provider with no real integration code as unsupported, never a more confident status", () => {
    for (const p of PROVIDER_CAPABILITIES) {
      if (!p.readSupport && !p.writeSupport && !p.webhookSupport) expect(p.baseStatus).toBe("unsupported");
    }
  });

  it("gives every unsupported provider a restriction note explaining why, instead of silence", () => {
    for (const p of PROVIDER_CAPABILITIES.filter((x) => x.baseStatus === "unsupported")) {
      expect(p.restrictions).toBeTruthy();
    }
  });

  it("providerById returns null for an unknown id rather than guessing", () => {
    expect(providerById("made-up-platform")).toBeNull();
    expect(providerById("meta")?.name).toContain("Meta");
  });
});

describe("ProviderRegistryService", () => {
  async function makeRegistry(opts: { metaAccountId?: string; googleCustomerId?: string; syncRows?: { platform: string; last_sync: string | null; last_error: string | null }[] }) {
    vi.resetModules();
    vi.doMock("../src/ads/settings", () => ({
      loadAds: vi.fn().mockResolvedValue({
        meta: { adAccountId: opts.metaAccountId ?? "" },
        google: { customerId: opts.googleCustomerId ?? "" },
      }),
    }));
    const q = vi.fn().mockResolvedValue(opts.syncRows ?? []);
    vi.doMock("../src/ads/db", () => ({ queryOn: () => q }));
    const { ProviderRegistryService } = await import("../src/integrations/provider-registry.service");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new ProviderRegistryService({ writePool: {} } as any);
  }

  it("marks Meta/Google as awaiting credentials when no ad account/customer id is configured", async () => {
    const svc = await makeRegistry({});
    const rows = await svc.registry();
    expect(rows.find((r) => r.id === "meta")!.status).toBe("awaiting_credentials");
    expect(rows.find((r) => r.id === "google")!.status).toBe("awaiting_credentials");
  });

  it("marks a configured platform production_verified once real deliveries have synced", async () => {
    const svc = await makeRegistry({
      metaAccountId: "123", syncRows: [{ platform: "meta", last_sync: "2026-01-01T00:00:00.000Z", last_error: null }],
    });
    const rows = await svc.registry();
    expect(rows.find((r) => r.id === "meta")!.status).toBe("production_verified");
  });

  it("never claims production_verified for a configured platform that has never actually synced", async () => {
    const svc = await makeRegistry({ metaAccountId: "123", syncRows: [] });
    const rows = await svc.registry();
    expect(rows.find((r) => r.id === "meta")!.status).toBe("connected");
  });

  it("leaves unsupported platforms exactly as unsupported regardless of any config", async () => {
    const svc = await makeRegistry({ metaAccountId: "123", googleCustomerId: "456" });
    const rows = await svc.registry();
    expect(rows.find((r) => r.id === "linkedin")!.status).toBe("unsupported");
  });
});
