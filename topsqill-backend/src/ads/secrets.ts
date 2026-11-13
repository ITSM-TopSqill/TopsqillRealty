import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { env } from "../common/env";

/**
 * Topsqill's own ad and payment credentials, read from Secret Manager at run
 * time (so adding or rotating a key needs no deploy). Each is a secret named
 * `<prefix>-<name>`, where the prefix is the environment's resource prefix
 * (for example topsqill-staging). Only ever read on the server.
 *
 *   meta-ads-token              Meta system user token (ads_management, leads_retrieval, pages_manage_ads, pages_read_engagement)
 *   google-ads-developer-token  Google Ads API developer token
 *   google-ads-oauth            JSON: {"client_id","client_secret","refresh_token"}
 *   razorpay-key-secret         Razorpay API key secret
 *   razorpay-webhook-secret     Razorpay webhook secret
 *
 * Without Google Cloud (local development), the same values come from
 * environment variables: ADS_META_ADS_TOKEN, ADS_RAZORPAY_KEY_SECRET, ...
 */
export type AdsSecretName = "meta-ads-token" | "google-ads-developer-token" | "google-ads-oauth" | "razorpay-key-secret" | "razorpay-webhook-secret";
export const ADS_SECRET_NAMES: AdsSecretName[] = ["meta-ads-token", "google-ads-developer-token", "google-ads-oauth", "razorpay-key-secret", "razorpay-webhook-secret"];

let client: SecretManagerServiceClient | null = null;
const cache = new Map<string, { v: string | null; at: number }>();
const TTL = 5 * 60_000;

export function secretPrefix() {
  return process.env.SECRET_PREFIX || (env.GCS_BUCKET_UPLOADS ?? "").replace(/-uploads$/, "") || "topsqill";
}
export const secretId = (name: AdsSecretName) => `${secretPrefix()}-${name}`;

export async function adsSecret(name: AdsSecretName): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: string | null = null;
  if (!env.GCP_PROJECT_ID) {
    v = process.env[`ADS_${name.toUpperCase().replace(/-/g, "_")}`] || null;
  } else {
    try {
      client ??= new SecretManagerServiceClient();
      const [ver] = await client.accessSecretVersion({ name: `projects/${env.GCP_PROJECT_ID}/secrets/${secretId(name)}/versions/latest` });
      const data = ver.payload?.data;
      v = data == null ? null : Buffer.from(data as Uint8Array).toString("utf8").trim() || null;
    } catch { v = null; }
  }
  cache.set(name, { v, at: Date.now() });
  return v;
}

/** Forget cached values, so a newly added key is picked up straight away. */
export function clearAdsSecrets() { cache.clear(); }
