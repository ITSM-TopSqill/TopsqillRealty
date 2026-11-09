/**
 * Headers that tell the API who the visitor really is, for its rate limits.
 *
 * The visitor can put anything in X-Forwarded-For, but each proxy in front of
 * this server appends the address it saw. Reading from the right, past the
 * TRUSTED_PROXY_HOPS proxies we run (default 1: Cloud Run's front end), gives
 * an address the visitor could not choose. The API only believes it because
 * it arrives with INTERNAL_PROXY_SECRET, which never leaves the two servers.
 */
export function visitorHeaders(incoming: Headers): Record<string, string> {
  const secret = process.env.INTERNAL_PROXY_SECRET;
  if (!secret) return {};
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1) || 1);
  const chain = (incoming.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = chain.length >= hops ? chain[chain.length - hops] : "local";
  return { "x-topsqill-client-ip": ip, "x-topsqill-proxy-key": secret };
}
