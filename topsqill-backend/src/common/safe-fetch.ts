import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";

/**
 * Fetches a page or file from a link a member pasted, safely.
 *
 * The server must never be tricked into reading its own network: Cloud Run's
 * metadata server (169.254.169.254) hands out credentials, and Redis or the
 * database sit on private addresses. So every address is checked at the
 * moment of connecting (a DNS answer can't change between check and use),
 * on every redirect, and only http/https on standard ports is allowed.
 */
export class FetchError extends Error {}

export type Fetched = { url: string; status: number; contentType: string; body: Buffer };

const UA = "Mozilla/5.0 (compatible; TopsqillBot/1.0; +https://topsqill.ai/bot)";

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)          // carrier-grade NAT
      || (a === 169 && b === 254)                     // link-local, cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff") || v.startsWith("64:ff9b:");
  }
  return true;
}

/** A DNS lookup that refuses non-public answers; used by the socket itself. */
function safeLookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "", 0);
    const list = (addresses as dns.LookupAddress[]).filter((a) => !isPrivateAddress(a.address));
    if (!list.length) return cb(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 0);
    if ((options as { all?: boolean }).all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

/** Parses and checks a link: http(s) only, standard ports, no credentials, no bare IPs on private ranges. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new FetchError("That doesn’t look like a web link."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new FetchError("Only http and https links can be imported.");
  if (u.username || u.password) throw new FetchError("Links with a username or password can’t be imported.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new FetchError("That link uses an unusual port and can’t be imported.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateAddress(host)) throw new FetchError("That link points to a private address.");
  if (/^(localhost|.*\.localhost|.*\.internal|.*\.local|metadata\.google\.internal)$/i.test(host)) throw new FetchError("That link points to a private address.");
  return u;
}

/** Removes ad-tracking parameters, so the same page imported twice is the same link. */
export function cleanUrl(raw: string): string {
  const u = checkUrl(raw);
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|gad_|gclid|gbraid|wbraid|fbclid|msclkid|mc_|_ga|ref$|igshid)/i.test(k)) u.searchParams.delete(k);
  }
  u.hash = "";
  return u.toString();
}

export async function safeFetch(rawUrl: string, opts: { maxBytes?: number; timeoutMs?: number; accept?: string; redirects?: number } = {}): Promise<Fetched> {
  const maxBytes = opts.maxBytes ?? 3_000_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  let url = checkUrl(rawUrl);
  for (let hop = 0; hop <= (opts.redirects ?? 4); hop++) {
    const res = await once(url, maxBytes, Math.max(1000, deadline - Date.now()), opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8");
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = checkUrl(new URL(res.location, url).toString());
      continue;
    }
    if (res.status >= 400) throw new FetchError(`The site answered with an error (${res.status}).`);
    return { url: url.toString(), status: res.status, contentType: res.contentType, body: res.body };
  }
  throw new FetchError("The link redirects too many times.");
}

function once(url: URL, maxBytes: number, timeoutMs: number, accept: string) {
  return new Promise<{ status: number; location?: string; contentType: string; body: Buffer }>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method: "GET", lookup: safeLookup as never, timeout: timeoutMs,
      headers: { "user-agent": UA, accept, "accept-encoding": "gzip, deflate, br", "accept-language": "en-IN,en;q=0.9" },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, location: res.headers.location, contentType: "", body: Buffer.alloc(0) }); }
      const announced = Number(res.headers["content-length"] || 0);
      if (announced > maxBytes) { res.destroy(); return reject(new FetchError("That file is too large to import.")); }
      const enc = String(res.headers["content-encoding"] || "").toLowerCase();
      const stream = enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); reject(new FetchError("That file is too large to import.")); return; }
        chunks.push(c);
      });
      stream.on("end", () => resolve({ status, contentType: String(res.headers["content-type"] || "").toLowerCase(), body: Buffer.concat(chunks) }));
      stream.on("error", (e: Error) => reject(new FetchError(`The page couldn’t be read (${e.message}).`)));
    });
    req.on("timeout", () => req.destroy(new FetchError("The site took too long to answer.")));
    req.on("error", (e: NodeJS.ErrnoException) => reject(e instanceof FetchError ? e
      : new FetchError(e.code === "EBLOCKED" ? "That link points to a private address." : e.code === "ENOTFOUND" ? "That website couldn’t be found." : `The site couldn’t be reached (${e.code ?? e.message}).`)));
    req.end();
  });
}
