import { z } from "zod";

/** Every setting the service needs. The app refuses to start if one is wrong. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8080),

  DATABASE_URL: z.string().min(1),
  DATABASE_URL_REPLICA: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().default(10),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Requests allowed per IP per minute, before Cloud Armor's own limit.
  THROTTLE_LIMIT: z.coerce.number().default(600),
  THROTTLE_TTL_MS: z.coerce.number().default(60_000),

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(2592000),

  GCP_PROJECT_ID: z.string().optional(),
  GCS_BUCKET_UPLOADS: z.string().optional(),
  GCS_BUCKET_PUBLIC: z.string().optional(),
  CDN_BASE_URL: z.string().default(""),
  // Without Cloud Storage (local development), files are kept in this folder
  // and served by the API itself from API_PUBLIC_URL.
  LOCAL_MEDIA_DIR: z.string().default(".media"),
  API_PUBLIC_URL: z.string().optional(),

  OTP_PROVIDER: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  // Email sign-in codes go out over SMTP. Without SMTP_HOST, codes are only
  // logged (development); in production, email sign-in is then switched off.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // The website's address, for links in alert emails.
  WEB_URL: z.string().default("https://topsqill.ai"),            // e.g. "Topsqill.ai <no-reply@topsqill.ai>"
  // Meta signs every lead-ads and WhatsApp webhook with the app secret. In
  // production, webhooks are refused outright until this is set.
  META_APP_SECRET: z.string().optional(),
  // Instagram API with Instagram Login: members connect their own account and pick posts and reels.
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),

  // Shared with the web app. Lets its server tell the API the real visitor IP
  // for rate limiting; without it, a forwarded IP header is never trusted.
  INTERNAL_PROXY_SECRET: z.string().min(16).optional(),
  // How many proxies (load balancer, Cloud Run front end) sit in front of the API.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-sonnet-5-5"),
  // Bright Data Web Unlocker, for importing from sites that block servers
  // (99acres, Housing.com...). Without a key, those need the page text pasted.
  BRIGHTDATA_API_KEY: z.string().optional(),
  BRIGHTDATA_ZONE: z.string().optional(),
  // api.sh: reads 99acres, MagicBricks and NoBroker listings as clean fields,
  // and any other page. Used instead of Bright Data when both are set.
  APISH_API_KEY: z.string().optional(),
  // On Google Cloud: the secret holding the api.sh keys (one per line). It is
  // re-read every 5 minutes, so keys can be added or changed without a deploy.
  APISH_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error("Invalid configuration:\n" + lines.join("\n"));
  }
  return parsed.data;
}

/**
 * Settings are read once, on first use. Reading them lazily means tests and
 * tooling can import any module without a full environment being present.
 */
let cached: Env | null = null;
export const getEnv = (): Env => (cached ??= loadEnv());
export const env: Env = new Proxy({} as Env, {
  get: (_t, key: string) => getEnv()[key as keyof Env],
  has: (_t, key: string) => key in getEnv(),
  ownKeys: () => Reflect.ownKeys(getEnv()),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});
export const isProd = () => getEnv().NODE_ENV === "production";
