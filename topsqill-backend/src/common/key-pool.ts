import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { env } from "./env";

/**
 * API keys that can change while the app runs, and can be several.
 *
 * - The keys live in one Secret Manager secret, one key per line (commas work
 *   too). The secret is re-read every 5 minutes, so adding a version with new
 *   keys takes effect without a redeploy. Locally, or if Secret Manager can't
 *   be read, the environment variable is used (same format).
 * - Keys are tried in order. One that is refused (bad, revoked, expired) is
 *   set aside for an hour; one out of credits for six hours; the call moves on
 *   to the next key. Reloading the keys clears both.
 * Keys are never logged or returned: only their last four characters.
 */
export type KeyState = { hint: string; state: "ok" | "rejected" | "no-credits"; until?: string; reason?: string };

const RELOAD_MS = 5 * 60_000;
let client: SecretManagerServiceClient | null = null;

export class KeyPool {
  private cache: { keys: string[]; at: number; source: "secret" | "env" | "none" } | null = null;
  private bad = new Map<string, { until: number; state: "rejected" | "no-credits"; reason: string }>();

  constructor(readonly label: string, private readonly envValue: () => string | undefined, private readonly secretName: () => string | undefined) {}

  /** True when any key could be available (the secret is named, or the variable is set). */
  get configured() { return !!(this.envValue()?.trim() || (this.secretName() && env.GCP_PROJECT_ID)); }

  /** All keys, re-read from Secret Manager at most every 5 minutes. */
  async all(): Promise<string[]> {
    if (this.cache && Date.now() - this.cache.at < RELOAD_MS) return this.cache.keys;
    let keys: string[] = [];
    let source: "secret" | "env" | "none" = "none";
    const name = this.secretName();
    if (name && env.GCP_PROJECT_ID) {
      try {
        client ??= new SecretManagerServiceClient();
        const [v] = await client.accessSecretVersion({ name: `projects/${env.GCP_PROJECT_ID}/secrets/${name}/versions/latest` });
        keys = parseKeys(Buffer.from((v.payload?.data ?? "") as Uint8Array).toString("utf8"));
        if (keys.length) source = "secret";
      } catch (e) {
        console.warn(`${this.label} keys: secret ${name} unreadable (${(e as Error).message.slice(0, 120)}); using the environment`);
      }
    }
    if (!keys.length) { keys = parseKeys(this.envValue() ?? ""); if (keys.length) source = "env"; }
    // A key removed from the secret is forgotten; one still there keeps its state.
    for (const k of [...this.bad.keys()]) if (!keys.includes(k)) this.bad.delete(k);
    this.cache = { keys, at: Date.now(), source };
    return keys;
  }

  /** Keys worth trying now, in order. */
  async usable(): Promise<string[]> {
    const now = Date.now();
    return (await this.all()).filter((k) => { const b = this.bad.get(k); return !b || b.until <= now; });
  }

  /** Sets a key aside: refused for an hour, out of credits for six. */
  setAside(key: string, state: "rejected" | "no-credits", reason: string) {
    this.bad.set(key, { until: Date.now() + (state === "rejected" ? 3600_000 : 6 * 3600_000), state, reason: reason.slice(0, 120) });
    console.warn(`${this.label} key …${key.slice(-4)} set aside: ${state}`);
  }

  /** Re-reads the keys now and forgets which ones failed (Admin → AI → Reload keys). */
  reload() { this.cache = null; this.bad.clear(); }

  async status() {
    const keys = await this.all();
    const now = Date.now();
    return {
      source: this.cache?.source ?? "none",
      keys: keys.map((k): KeyState => {
        const b = this.bad.get(k);
        return b && b.until > now
          ? { hint: `…${k.slice(-4)}`, state: b.state, until: new Date(b.until).toISOString(), reason: b.reason }
          : { hint: `…${k.slice(-4)}`, state: "ok" };
      }),
    };
  }
}

export function parseKeys(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((k) => k.trim()).filter((k) => k.length >= 8 && !k.startsWith("#")))];
}

/** api.sh keys: secret named by APISH_SECRET (on Google Cloud), or APISH_API_KEY. */
export const apishKeys = new KeyPool("api.sh", () => env.APISH_API_KEY, () => env.APISH_SECRET);
