import { timingSafeEqual } from "node:crypto";

export const CLIENT_IP_HEADER = "x-topsqill-client-ip";
export const PROXY_KEY_HEADER = "x-topsqill-proxy-key";

type Req = { ip?: string; headers: Record<string, string | string[] | undefined> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The visitor's IP address, for rate limiting.
 *
 * Browsers reach the API through the web app's server, so the address the API
 * sees is the web server's. The web server therefore passes the visitor's IP in
 * its own header, and that header is believed only when it arrives with the
 * shared INTERNAL_PROXY_SECRET. Anything else falls back to `req.ip`, which
 * Fastify derives from a fixed number of trusted proxy hops, so a client can
 * never pick its own address by sending X-Forwarded-For.
 */
export function clientIp(req: Req, proxySecret: string | undefined): string {
  const key = first(req.headers[PROXY_KEY_HEADER]);
  const claimed = first(req.headers[CLIENT_IP_HEADER])?.trim();
  if (proxySecret && key && claimed && safeEqual(key, proxySecret) && /^[0-9a-fA-F:.]{2,45}$/.test(claimed)) {
    return claimed;
  }
  return req.ip || "unknown";
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
