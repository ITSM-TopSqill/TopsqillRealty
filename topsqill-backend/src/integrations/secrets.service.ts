import { Injectable, Logger } from "@nestjs/common";
import { env } from "../common/env";

/**
 * Access tokens live in Google Secret Manager, never in the database and never
 * in the browser. In development, an in-memory store stands in so the flow can
 * be tested without a cloud project.
 */
@Injectable()
export class SecretsService {
  private readonly log = new Logger("secrets");
  private readonly local = new Map<string, string>();
  private client: { createSecret: Function; addSecretVersion: Function; accessSecretVersion: Function; deleteSecret: Function } | null = null;

  private async gcp() {
    if (!env.GCP_PROJECT_ID) return null;
    if (!this.client) {
      try {
        const mod: any = await import("@google-cloud/secret-manager" as string);
        this.client = new mod.SecretManagerServiceClient();
      } catch { return null; }
    }
    return this.client;
  }

  async put(name: string, value: string): Promise<string> {
    const id = name.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 200);
    const client = await this.gcp();
    if (!client) { this.local.set(id, value); return id; }
    const parent = `projects/${env.GCP_PROJECT_ID}`;
    try { await (client as any).createSecret({ parent, secretId: id, secret: { replication: { automatic: {} } } }); }
    catch { /* already exists: a new version is added below */ }
    await (client as any).addSecretVersion({ parent: `${parent}/secrets/${id}`, payload: { data: Buffer.from(value, "utf8") } });
    return id;
  }

  async get(name: string): Promise<string | null> {
    if (!name) return null;
    const client = await this.gcp();
    if (!client) return this.local.get(name) ?? null;
    try {
      const [v] = await (client as any).accessSecretVersion({ name: `projects/${env.GCP_PROJECT_ID}/secrets/${name}/versions/latest` });
      return v.payload?.data?.toString() ?? null;
    } catch (e) { this.log.warn(`secret ${name} unavailable: ${(e as Error).message}`); return null; }
  }

  async remove(name: string): Promise<void> {
    const client = await this.gcp();
    if (!client) { this.local.delete(name); return; }
    try { await (client as any).deleteSecret({ name: `projects/${env.GCP_PROJECT_ID}/secrets/${name}` }); } catch { /* already gone */ }
  }
}
