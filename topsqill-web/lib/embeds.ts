/**
 * Video and 3D-tour links a listing may show, turned into their official
 * embed addresses. Same rules as the API (src/common/embeds.ts): anything
 * else is never framed.
 */
export type Embed = { provider: string; url: string; embed: string };

export function videoEmbed(raw?: string | null): Embed | null {
  const u = parse(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^(www\.|m\.)/, "");
  let id = "";
  if (host === "youtu.be") id = u.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]+)/)?.[1] ?? "";
  }
  if (/^[\w-]{11}$/.test(id)) return { provider: "youtube", url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0` };
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const vid = u.pathname.match(/(?:^|\/)(\d{6,12})(?:\/|$)/)?.[1];
    if (vid) return { provider: "vimeo", url: `https://vimeo.com/${vid}`, embed: `https://player.vimeo.com/video/${vid}` };
  }
  return null;
}

export function tourEmbed(raw?: string | null): Embed | null {
  const u = parse(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "");
  if (host === "my.matterport.com" || host === "matterport.com") {
    const m = u.searchParams.get("m");
    if (m && /^[\w-]{8,20}$/.test(m)) return { provider: "matterport", url: `https://my.matterport.com/show/?m=${m}`, embed: `https://my.matterport.com/show/?m=${m}&play=1&qs=1` };
  }
  if (host === "kuula.co") {
    const path = u.pathname.match(/^\/share\/(?:collection\/)?[\w-]+/)?.[0];
    if (path) return { provider: "kuula", url: `https://kuula.co${path}`, embed: `https://kuula.co${path}?fs=1&vr=1&thumbs=1` };
  }
  if (host === "momento360.com") {
    const path = u.pathname.match(/^\/e\/[\w\-/]+/)?.[0];
    if (path) return { provider: "momento360", url: `https://momento360.com${path}`, embed: `https://momento360.com${path}` };
  }
  if (host === "app.cloudpano.com") {
    const path = u.pathname.match(/^\/tours\/[\w-]+/)?.[0];
    if (path) return { provider: "cloudpano", url: `https://app.cloudpano.com${path}`, embed: `https://app.cloudpano.com${path}` };
  }
  const v = videoEmbed(raw);
  return v ? { ...v, provider: `${v.provider}-360` } : null;
}

function parse(raw?: string | null): URL | null {
  if (!raw) return null;
  try {
    const t = raw.trim();
    const u = new URL(t.startsWith("http") ? t : `https://${t}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch { return null; }
}
