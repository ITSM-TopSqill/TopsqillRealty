import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { CacheService } from "../redis/redis.module";
import { safeFetch } from "../common/safe-fetch";

export type Place = { label: string; lat: number; lng: number; locality: string | null; city: string | null };

type Nominatim = { display_name?: string; lat: string; lon: string; address?: Record<string, string>; name?: string };

/** Turns OpenStreetMap's address parts into the locality and city a listing uses. */
export function placeFrom(r: Nominatim): Place {
  const a = r.address ?? {};
  const locality = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.residential || a.village || a.hamlet || a.town || null;
  const city = a.city || a.town || a.state_district || a.county || null;
  const parts = (r.display_name ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Short and readable: the first three parts ("DLF The Crest, Sector 54, Gurugram"), without the pincode, state or country.
  const label = parts.filter((p) => !/^\d{6}$/.test(p) && p !== "India").slice(0, 3).join(", ") || r.name || "Selected place";
  return { label, lat: Number(r.lat), lng: Number(r.lon), locality, city: city?.replace(/^Gurugram$/i, "Gurgaon").replace(/^Bangalore$/i, "Bengaluru") ?? null };
}

/**
 * Address search and reverse lookup for the listing form's location picker,
 * from OpenStreetMap (Nominatim): free, India only. Results are cached for a
 * month, and each member is limited to 30 lookups a minute, which keeps us
 * well inside Nominatim's fair-use policy.
 */
@Injectable()
export class GeoService {
  constructor(private readonly cache: CacheService) {}

  private async limit(userId: string) {
    const key = `geo:rate:${userId}:${Math.floor(Date.now() / 60_000)}`;
    const n = await this.cache.redis.incr(key).catch(() => 0);
    if (n === 1) await this.cache.redis.expire(key, 70).catch(() => {});
    if (n > 30) throw new HttpException("Too many searches. Wait a moment and try again.", HttpStatus.TOO_MANY_REQUESTS);
  }

  private async nominatim<T>(path: string, cacheKey: string): Promise<T | null> {
    const hit = await this.cache.get<T | "none">(cacheKey);
    if (hit) return hit === "none" ? null : hit;
    try {
      const res = await safeFetch(`https://nominatim.openstreetmap.org/${path}`, { accept: "application/json", timeoutMs: 7000, maxBytes: 400_000 });
      const data = JSON.parse(res.body.toString("utf8")) as T;
      await this.cache.set(cacheKey, data ?? "none", 30 * 86_400);
      return data;
    } catch { return null; }
  }

  async search(userId: string, q: string, near?: string): Promise<{ items: Place[] }> {
    const query = [q.trim(), near?.trim()].filter(Boolean).join(", ").slice(0, 200);
    if (query.length < 3) return { items: [] };
    await this.limit(userId);
    const rows = await this.nominatim<Nominatim[]>(
      `search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&q=${encodeURIComponent(query)}`, `geo:s:${query.toLowerCase()}`);
    return { items: (rows ?? []).map(placeFrom).filter((p) => p.lat > 6 && p.lat < 37.5 && p.lng > 68 && p.lng < 98).slice(0, 6) };
  }

  async reverse(userId: string, lat: number, lng: number): Promise<Place | null> {
    if (!(lat > 6 && lat < 37.5 && lng > 68 && lng < 98)) return null;
    await this.limit(userId);
    const r = await this.nominatim<Nominatim>(
      `reverse?format=jsonv2&addressdetails=1&zoom=17&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`, `geo:r:${lat.toFixed(4)},${lng.toFixed(4)}`);
    return r && r.lat ? { ...placeFrom(r), lat, lng } : null;
  }
}
