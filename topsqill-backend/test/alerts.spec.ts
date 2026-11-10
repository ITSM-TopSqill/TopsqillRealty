/** Alert emails, alert links and the local file store's safety checks. */
import { describe, it, expect, beforeAll } from "vitest";
import { renderAlertEmail, alertPath } from "../src/notifications/alert-email";

describe("alert emails", () => {
  it("links each kind of alert to the right page", () => {
    expect(alertPath("conversation", "c1")).toBe("/messages?c=c1");
    expect(alertPath("profile", "u1")).toBe("/profile/u1");
    expect(alertPath("post", "p1")).toBe("/posts/p1");
    expect(alertPath("job", "j1")).toBe("/jobs/j1");
    expect(alertPath(null, null)).toBe("/notifications");
  });

  it("escapes what members wrote and carries the link", () => {
    const m = renderAlertEmail({ kind: "message", title: "New message from <b>Riya</b>", body: "<script>x</script>", url: "https://topsqill.ai/messages?c=1", name: "Aman Gupta" });
    expect(m.subject).toBe("New message from <b>Riya</b>");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;b&gt;Riya&lt;/b&gt;");
    expect(m.html).toContain('href="https://topsqill.ai/messages?c=1"');
    expect(m.html).toContain(">Reply<");
    expect(m.text).toContain("Hi Aman,");
  });
});

describe("local file store", () => {
  let storage: typeof import("../src/media/storage");
  beforeAll(async () => {
    process.env.DATABASE_URL = "postgres://x@localhost/x";
    process.env.JWT_SECRET = "test-secret-at-least-16";
    delete process.env.GCP_PROJECT_ID;
    process.env.LOCAL_MEDIA_DIR = "/tmp/topsqill-test-media";
    storage = await import("../src/media/storage");
  });

  it("only accepts links it signed", () => {
    const sig = storage.sign("up:m1:123");
    expect(storage.checkSignature("up:m1:123", sig)).toBe(true);
    expect(storage.checkSignature("up:m2:123", sig)).toBe(false);
    expect(storage.checkSignature("up:m1:123", "forged")).toBe(false);
  });

  it("refuses paths that escape its folder", () => {
    expect(() => storage.localPath("public", "../uploads/private/u1/doc.pdf")).toThrow();
    expect(() => storage.localPath("uploads", "../../etc/passwd")).toThrow();
    expect(storage.localPath("public", "public/img/a/thumb.avif")).toBe("/tmp/topsqill-test-media/public/public/img/a/thumb.avif");
  });
});
