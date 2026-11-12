"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clientApi } from "@/lib/api";
import { inr } from "@/lib/format";

type Point = { month: string; value: number; n: number };
type Trend = {
  locality: string; city: string; unit: string; listing: number | null;
  localitySeries: Point[]; citySeries: Point[]; changePct: number | null; vsLocalityPct: number | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const money = (v: number, unit: string) => (unit.startsWith("per") ? `₹${v.toLocaleString("en-IN")}` : inr(v));

/**
 * How prices moved in this listing's locality over 12 months (median rate per
 * sq ft for sale, median rent for rentals), with the city as a second line
 * and this home's own price as a reference line. Hover for exact values;
 * "Show as table" lists them.
 */
export function PriceTrend({ listingId }: { listingId: string }) {
  const [t, setT] = useState<Trend | null>(null);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { clientApi<Trend>(`/v1/listings/${listingId}/price-trend`).then(setT).catch(() => setT(null)); }, [listingId]);

  const months = useMemo(() => (t ? [...new Set([...t.localitySeries, ...t.citySeries].map((p) => p.month))].sort() : []), [t]);
  if (!t || months.length < 2) return null;

  const loc = new Map(t.localitySeries.map((p) => [p.month, p]));
  const city = new Map(t.citySeries.map((p) => [p.month, p]));
  const values = [...t.localitySeries, ...t.citySeries].map((p) => p.value).concat(t.listing ? [t.listing] : []);
  const lo = Math.min(...values) * 0.94, hi = Math.max(...values) * 1.04;
  const W = 640, H = 240, L = 64, R = 16, T = 14, B = 30;
  const x = (i: number) => L + (i / Math.max(months.length - 1, 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const path = (m: Map<string, Point>) => months.map((mo, i) => (m.has(mo) ? `${x(i)},${y(m.get(mo)!.value)}` : null))
    .reduce((acc: string[], pt, i, arr) => { if (pt) acc.push(`${acc.length && arr[i - 1] ? "L" : "M"}${pt}`); return acc; }, []).join(" ");
  const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 4);

  function move(e: React.PointerEvent) {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (months.length - 1));
    setHover(Math.max(0, Math.min(months.length - 1, i)));
  }

  const sentence = [
    t.changePct != null ? `Prices in ${t.locality} are ${t.changePct >= 0 ? "up" : "down"} ${Math.abs(t.changePct)}% over this period.` : `Not enough listings in ${t.locality} yet for a trend; the city line shows ${t.city}.`,
    t.vsLocalityPct != null ? `This home is ${Math.abs(t.vsLocalityPct)}% ${t.vsLocalityPct <= 0 ? "below" : "above"} the locality’s latest median.` : "",
  ].filter(Boolean).join(" ");
  const hm = hover != null ? months[hover] : null;

  return (
    <div className="card pad ptrend" style={{ marginBottom: 16 }}>
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>📈 Price trend</h2>
        <button type="button" className="linklike small" onClick={() => setTable((v) => !v)}>{table ? "Show as chart" : "Show as table"}</button>
      </div>
      <p className="small" style={{ margin: "6px 0 8px" }}>{sentence}</p>
      <div className="row small" style={{ gap: 14, flexWrap: "wrap", marginBottom: 6 }} aria-hidden={table}>
        {t.localitySeries.length ? <span className="row" style={{ gap: 6 }}><i className="pt-key pt-loc" />{t.locality} median</span> : null}
        <span className="row" style={{ gap: 6 }}><i className="pt-key pt-city" />{t.city} median</span>
        {t.listing ? <span className="row" style={{ gap: 6 }}><i className="pt-key pt-own" />This home</span> : null}
        <span className="muted">({t.unit})</span>
      </div>
      {table ? (
        <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ textAlign: "left" }}>Month</th><th style={{ textAlign: "right" }}>{t.locality}</th><th style={{ textAlign: "right" }}>{t.city}</th></tr></thead>
          <tbody>{months.map((m) => (
            <tr key={m} style={{ borderTop: "1px solid var(--line)" }}>
              <td>{label(m)}</td>
              <td style={{ textAlign: "right" }}>{loc.has(m) ? `${money(loc.get(m)!.value, t.unit)} (${loc.get(m)!.n})` : "—"}</td>
              <td style={{ textAlign: "right" }}>{city.has(m) ? `${money(city.get(m)!.value, t.unit)} (${city.get(m)!.n})` : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : (
        <div ref={box} style={{ position: "relative" }} onPointerMove={move} onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price trend for ${t.locality} and ${t.city}. ${sentence}`} style={{ width: "100%", height: "auto", display: "block" }}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="pt-grid" />
                <text x={L - 8} y={y(v) + 4} textAnchor="end" className="pt-axis">{money(Math.round(v), t.unit)}</text>
              </g>
            ))}
            {months.map((m, i) => (i % Math.ceil(months.length / 6) === 0 || i === months.length - 1
              ? <text key={m} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"} className="pt-axis">{label(m)}</text> : null))}
            {t.listing ? (
              <g>
                <line x1={L} x2={W - R} y1={y(t.listing)} y2={y(t.listing)} className="pt-own-line" />
                <text x={W - R} y={y(t.listing) - 6} textAnchor="end" className="pt-label">This home {money(t.listing, t.unit)}</text>
              </g>
            ) : null}
            <path d={path(city)} className="pt-line pt-city-s" />
            <path d={path(loc)} className="pt-line pt-loc-s" />
            {months.map((m, i) => (
              <g key={m}>
                {city.has(m) ? <circle cx={x(i)} cy={y(city.get(m)!.value)} r={hover === i ? 5 : 4} className="pt-dot pt-city-d" /> : null}
                {loc.has(m) ? <circle cx={x(i)} cy={y(loc.get(m)!.value)} r={hover === i ? 5 : 4} className="pt-dot pt-loc-d" /> : null}
              </g>
            ))}
            {hover != null ? <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="pt-cross" /> : null}
          </svg>
          {hm ? (
            <div className="pt-tip small" style={{ left: `${(x(hover!) / W) * 100}%` }} role="status">
              <b>{label(hm)}</b>
              <div><i className="pt-key pt-loc" /> {t.locality}: {loc.has(hm) ? `${money(loc.get(hm)!.value, t.unit)} · ${loc.get(hm)!.n} listing${loc.get(hm)!.n === 1 ? "" : "s"}` : "no listings"}</div>
              <div><i className="pt-key pt-city" /> {t.city}: {city.has(hm) ? money(city.get(hm)!.value, t.unit) : "—"}</div>
            </div>
          ) : null}
        </div>
      )}
      <p className="small muted" style={{ margin: "8px 0 0" }}>From asking prices of listings on Topsqill.ai, by the month they were listed. Not a valuation.</p>
      <style>{`
        .ptrend{--pt-loc:#2a78d6;--pt-city:#eb6834;--pt-ink:#52514e;--pt-muted:#898781;--pt-grid:#e1e0d9;--pt-surface:#fcfcfb}
        @media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .ptrend{--pt-loc:#3987e5;--pt-city:#d95926;--pt-ink:#c3c2b7;--pt-grid:#2c2c2a;--pt-surface:#1a1a19}}
        :root[data-theme="dark"] .ptrend{--pt-loc:#3987e5;--pt-city:#d95926;--pt-ink:#c3c2b7;--pt-grid:#2c2c2a;--pt-surface:#1a1a19}
        .pt-grid{stroke:var(--pt-grid);stroke-width:1}
        .pt-axis{fill:var(--pt-muted);font-size:11px}
        .pt-label{fill:var(--pt-ink);font-size:11px;font-weight:600}
        .pt-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
        .pt-loc-s{stroke:var(--pt-loc)} .pt-city-s{stroke:var(--pt-city)}
        .pt-dot{stroke:var(--card,#fff);stroke-width:2} .pt-loc-d{fill:var(--pt-loc)} .pt-city-d{fill:var(--pt-city)}
        .pt-own-line{stroke:var(--pt-ink);stroke-width:1.5;stroke-dasharray:5 4}
        .pt-cross{stroke:var(--pt-muted);stroke-width:1}
        .pt-key{display:inline-block;width:12px;height:3px;border-radius:2px;vertical-align:middle}
        .pt-loc{background:var(--pt-loc)} .pt-city{background:var(--pt-city)} .pt-own{background:repeating-linear-gradient(90deg,var(--pt-ink) 0 4px,transparent 4px 7px)}
        .pt-tip{position:absolute;top:8px;transform:translateX(-50%);background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;padding:8px 10px;box-shadow:0 6px 18px rgba(0,0,0,.12);pointer-events:none;white-space:nowrap;z-index:2}
      `}</style>
    </div>
  );
}
