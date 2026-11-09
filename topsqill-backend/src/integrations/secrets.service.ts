import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { env, isProd } from "../common/env";

/** gRPC status for "already exists". */
const ALREADY_EXISTS = 6;

/**
 * Access tokens live in Google Secret Manager, never in the database and never
 * in the browser.
 *
 * Outside production, with no GCP project configured, an in-memory store stands
 * in so the flow can be tested locally. Production never uses it: a token held
 * in one container's memory is lost on restart and invisible to every other
 * instance, so a missing configuration is an error, not a silent fallback.
 */
@Injectable()
export class SecretsService {
  private readonly log = new Logger("secrets");
  private readonly local = new Map<string, string>();
  private client: SecretManagerServiceClient | null = null;

  private gcp(): SecretManagerServiceClient | null {
    if (!env.GCP_PROJECT_ID) {
      if (isProd()) throw new ServiceUnavailableException("Secret storage is not configured.");
      return null;
    }
    return (this.client ??= new SecretManagerServiceClient());
  }

  async put(name: string, value: string): Promise<string> {
    const id = name.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 200);
    const client = this.gcp();
    if (!client) { this.local.set(id, value); return id; }
    const parent = `projects/${env.GCP_PROJECT_ID}`;
    try {
      await client.createSecret({ parent, secretId: id, secret: { replication: { automatic: {} } } });
    } catch (e) {
      // Reconnecting adds a new version to the existing secret; anything else is a real failure.
      if ((e as { code?: number }).code !== ALREADY_EXISTS) throw e;
    }
    await client.addSecretVersion({ parent: `${parent}/secrets/${id}`, payload: { data: Buffer.from(value, "utf8") } });
    return id;
  }

  async get(name: string): Promise<string | null> {
    if (!name) return null;
    const client = this.gcp();
    if (!client) return this.local.get(name) ?? null;
    try {
      const [v] = await client.accessSecretVersion({ name: `projects/${env.GCP_PROJECT_ID}/secrets/${name}/versions/latest` });
      const data = v.payload?.data;
      return data == null ? null : Buffer.from(data as Uint8Array).toString("utf8");
    } catch (e) { this.log.warn(`secret ${name} unavailable: ${(e as Error).message}`); return null; }
  }

  async remove(name: string): Promise<void> {
    const client = this.gcp();
    if (!client) { this.local.delete(name); return; }
    try { await client.deleteSecret({ name: `projects/${env.GCP_PROJECT_ID}/secrets/${name}` }); } catch { /* already gone */ }
  }
}
