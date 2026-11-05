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

  OTP_PROVIDER: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-sonnet-5-5"),
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
