import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "test-secret-at-least-16";
});

import { aiAllowed, cleanAiSettings } from "../src/ai/ai-settings";
import { speakable } from "../src/common/tts";
import { isDemoEmail } from "../src/auth/auth.service";

describe("AI settings", () => {
  it("keeps only known features and models", () => {
    expect(cleanAiSettings({ enabled: true, disabled: ["write.post", "bogus", "write.post"], model: "gpt-4" }))
      .toEqual({ enabled: true, disabled: ["write.post"], model: null });
    expect(cleanAiSettings(null)).toEqual({ enabled: true, disabled: [], model: null });
    expect(cleanAiSettings({ enabled: false, model: "claude-haiku-5-5" })).toEqual({ enabled: false, disabled: [], model: "claude-haiku-5-5" });
  });
  it("switches features off one by one, or all at once", () => {
    const s = cleanAiSettings({ enabled: true, disabled: ["write.post"] });
    expect(aiAllowed(s, "write.post")).toBe(false);
    expect(aiAllowed(s, "assistant")).toBe(true);
    expect(aiAllowed({ ...s, enabled: false }, "assistant")).toBe(false);
  });
});

describe("podcast speech", () => {
  it("reads prices and sizes the Indian way", () => {
    expect(speakable("A 3 BHK at ₹1.82 Cr, 1,650 sq ft")).toBe("A 3 B H K at 1.82 crore rupees, 1,650 square feet");
    expect(speakable("Rent ₹45 L")).toBe("Rent 45 lakh rupees");
  });
});

describe("demo profiles", () => {
  it("are only the seeded demo addresses", () => {
    expect(isDemoEmail("ishita.singh@demo.topsqill.ai")).toBe(true);
    expect(isDemoEmail("contact@topsqill.com")).toBe(false);
    expect(isDemoEmail("someone@demo.topsqill.ai.evil.com")).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
  });
});
