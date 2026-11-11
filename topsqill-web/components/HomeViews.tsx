"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildPlan, canPlan, dims, labelSpot, ROOM_COLOURS, type FloorPlan } from "@/lib/floorplan";
import type { Walkthrough, Hologram, WalkMode } from "@/lib/home3d";

type Props = { title: string; kind: string; bhk?: number | null; areaSqft?: number | null; facing?: string | null };
type Tab = "plan" | "3d" | "holo";

/**
 * A 2D floor plan, a 3D walkthrough and a hologram view of a listing, all
 * built from its bedrooms and area. They show a typical layout of that size,
 * not the home's real plan, and say so.
 */
export function HomeViews({ title, kind, bhk, areaSqft, facing }: Props) {
  const plan = useMemo(() => (canPlan(kind, bhk, areaSqft) ? buildPlan(bhk!, areaSqft!) : null), [kind, bhk, areaSqft]);
  const [tab, setTab] = useState<Tab>("plan");
  if (!plan) return null;
  return (
    <div className="card pad" style={{ marginBottom: 16 }}>
      <div className="spread" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>🏠 See the layout</h2>
        <div className="row" role="tablist" style={{ gap: 6, flexWrap: "wrap" }}>
          {([["plan", "📐 2D plan"], ["3d", "🧊 3D walkthrough"], ["holo", "✨ Hologram"]] as [Tab, string][]).map(([t, name]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`chip${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{name}</button>
          ))}
        </div>
      </div>
      {tab === "plan" ? <PlanSvg plan={plan} facing={facing} title={title} /> : tab === "3d" ? <Walk plan={plan} title={title} /> : <Holo plan={plan} title={title} />}
      <p className="small muted" style={{ margin: "8px 0 0" }}>
        Illustrative layout of a typical {plan.bhk} BHK with about {plan.carpetSqft.toLocaleString("en-IN")} sq ft of carpet area, made from this listing’s details.
        It is not the actual floor plan: ask the owner for that.
      </p>
    </div>
  );
}

/** The plan as a drawing: rooms with sizes, walls, door swings and the entrance. */
export function PlanSvg({ plan, facing, title, height }: { plan: FloorPlan; facing?: string | null; title: string; height?: number }) {
  const pad = 3;
  const vb = `${-pad} ${-5 - pad} ${plan.width + pad * 2} ${plan.depth + 5 + pad * 2}`;
  const dir = facing?.match(/\b(north|south|east|west)(?:[- ]?(east|west))?\b/i)?.[0];
  return (
    <div style={{ background: "#fbfaf7", borderRadius: 14, padding: 8, position: "relative" }}>
      <svg viewBox={vb} role="img" aria-label={`Illustrative floor plan of ${title}`} style={{ width: "100%", height: height ?? "auto", maxHeight: height ?? 520, display: "block" }}>
        {plan.rooms.map((r) => (
          <rect key={r.id} x={r.x} y={r.y} width={r.w} height={r.d} fill={ROOM_COLOURS[r.kind].plan} />
        ))}
        {plan.walls.map((w, i) => (
          <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={w.low ? "#7c8a74" : "#2b2a33"} strokeWidth={w.low ? 0.25 : 0.5}
            strokeDasharray={w.low ? "0.6 0.4" : undefined} strokeLinecap="square" />
        ))}
        {plan.doors.filter((d) => d.width <= 4.5).map((d, i) => {
          // A door hinged at one side of the opening, swinging into the room beyond (+x or +y).
          const hw = d.width;
          const [hx, hy] = d.axis === "h" ? [d.x - hw / 2, d.y] : [d.x, d.y - hw / 2];
          const [lx, ly] = d.axis === "h" ? [hx, hy + hw] : [hx + hw, hy];
          const [cx, cy] = d.axis === "h" ? [hx + hw, hy] : [hx, hy + hw];
          return (
            <g key={i} stroke={d.main ? "#5b3cc4" : "#6b6875"} fill="none" strokeWidth={0.18}>
              <line x1={hx} y1={hy} x2={lx} y2={ly} strokeWidth={0.3} />
              <path d={`M ${lx} ${ly} A ${hw} ${hw} 0 0 ${d.axis === "h" ? 0 : 1} ${cx} ${cy}`} strokeDasharray="0.4 0.3" />
            </g>
          );
        })}
        {plan.rooms.filter((r) => r.id !== "hall").map((r) => {
          const fs = Math.min(r.w < 8 || r.d < 6 ? 0.85 : 1.25, (r.w - 0.8) / (r.name.length * 0.6));
          const { x: cx, y: cy } = labelSpot(plan, r);
          return (
            <g key={r.id} textAnchor="middle" fontFamily="system-ui, sans-serif">
              <text x={cx} y={cy - fs * 0.15} fontSize={fs} fontWeight={700} fill="#2b2a33">{r.name}</text>
              <text x={cx} y={cy + fs * 1.05} fontSize={fs * 0.8} fill="#6b6875">{dims(r)}</text>
            </g>
          );
        })}
        {plan.doors.filter((d) => d.main).map((d, i) => (
          <g key={i} fontFamily="system-ui, sans-serif">
            <path d={`M ${d.x - 2.6} ${d.y} l 1.6 0 m -0.6 -0.6 l 0.6 0.6 l -0.6 0.6`} stroke="#5b3cc4" strokeWidth={0.25} fill="none" />
            <text x={d.x - 1.6} y={d.y + 2.4} fontSize={0.8} fill="#5b3cc4" textAnchor="end" transform={`rotate(-90 ${d.x - 1.6} ${d.y + 2.4})`}>Entrance</text>
          </g>
        ))}
        <g fontFamily="system-ui, sans-serif" fontSize={0.8} fill="#6b6875">
          <line x1={plan.width - 10} y1={plan.depth + 1.5} x2={plan.width} y2={plan.depth + 1.5} stroke="#6b6875" strokeWidth={0.2} />
          <line x1={plan.width - 10} y1={plan.depth + 1} x2={plan.width - 10} y2={plan.depth + 2} stroke="#6b6875" strokeWidth={0.2} />
          <line x1={plan.width} y1={plan.depth + 1} x2={plan.width} y2={plan.depth + 2} stroke="#6b6875" strokeWidth={0.2} />
          <text x={plan.width - 5} y={plan.depth + 2.9} textAnchor="middle">10 ft</text>
        </g>
      </svg>
      {dir ? <span className="pill" style={{ position: "absolute", left: 12, top: 10, background: "#fff" }}>🧭 {dir[0].toUpperCase() + dir.slice(1).toLowerCase()} facing</span> : null}
    </div>
  );
}

function Stage({ children, dark = false, stageRef }: { children?: React.ReactNode; dark?: boolean; stageRef: React.RefObject<HTMLDivElement | null> }) {
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <div ref={wrap} style={{ position: "relative", aspectRatio: "16/10", maxHeight: "78vh", width: "100%", borderRadius: 14, overflow: "hidden", background: dark ? "#000" : "#dfe7ee" }}>
      <div ref={stageRef} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }} />
      {children}
      <button type="button" className="pill" aria-label="Full screen" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen?.())}
        style={{ position: "absolute", right: 10, top: 10, background: "rgba(20,16,40,.6)", color: "#fff", border: 0, cursor: "pointer" }}>⛶</button>
    </div>
  );
}

function useWebGL() {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    try { const c = document.createElement("canvas"); setOk(!!(c.getContext("webgl2") || c.getContext("webgl"))); } catch { setOk(false); }
  }, []);
  return ok;
}

function Walk({ plan, title }: { plan: FloorPlan; title: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const ctl = useRef<Walkthrough | null>(null);
  const [mode, setMode] = useState<WalkMode>("dollhouse");
  const [room, setRoom] = useState("");
  const [loading, setLoading] = useState(true);
  const webgl = useWebGL();

  useEffect(() => {
    if (!webgl) return;
    let gone = false;
    import("@/lib/home3d").then(({ mountWalkthrough }) => {
      if (gone || !stage.current) return;
      ctl.current = mountWalkthrough(stage.current, plan, setRoom);
      setLoading(false);
    });
    return () => { gone = true; ctl.current?.dispose(); ctl.current = null; };
  }, [plan, webgl]);

  const pick = (m: WalkMode) => { setMode(m); ctl.current?.setMode(m); };
  if (!webgl) return <p className="muted">Your browser can’t show 3D. Try the 2D plan.</p>;
  const hold = (f: number, t: number) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); ctl.current?.steer(f, t); },
    onPointerUp: () => ctl.current?.steer(0, 0), onPointerLeave: () => ctl.current?.steer(0, 0), onPointerCancel: () => ctl.current?.steer(0, 0),
  });
  const pad: React.CSSProperties = { width: 44, height: 44, borderRadius: 12, border: 0, background: "rgba(20,16,40,.6)", color: "#fff", fontSize: 18, touchAction: "none", cursor: "pointer" };
  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {([["dollhouse", "🏠 Dollhouse"], ["tour", "▶ Guided tour"], ["walk", "🚶 Walk around"]] as [WalkMode, string][]).map(([m, name]) => (
          <button key={m} type="button" className={`chip${mode === m ? " on" : ""}`} onClick={() => pick(m)}>{name}</button>
        ))}
      </div>
      <Stage stageRef={stage}>
        {loading ? <span className="pill" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}>Building {title}…</span> : null}
        {room ? <span className="pill" style={{ position: "absolute", left: 10, top: 10, background: "rgba(20,16,40,.6)", color: "#fff" }}>{room}</span> : null}
        {mode === "walk" ? (
          <div style={{ position: "absolute", left: 10, bottom: 10, display: "grid", gridTemplateColumns: "repeat(3,44px)", gap: 4 }}>
            <span /><button type="button" aria-label="Walk forward" style={pad} {...hold(1, 0)}>▲</button><span />
            <button type="button" aria-label="Turn left" style={pad} {...hold(0, -1)}>◀</button>
            <button type="button" aria-label="Walk back" style={pad} {...hold(-1, 0)}>▼</button>
            <button type="button" aria-label="Turn right" style={pad} {...hold(0, 1)}>▶</button>
          </div>
        ) : null}
      </Stage>
      <p className="small muted" style={{ margin: "6px 0 0" }}>
        {mode === "dollhouse" ? "Drag to turn the home, scroll or pinch to zoom." : mode === "tour" ? "Sit back: the tour walks through every room." : "Drag to look around. Walk with the arrows, or W A S D with the pointer over the view."}
      </p>
    </div>
  );
}

function Holo({ plan, title }: { plan: FloorPlan; title: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const ctl = useRef<Hologram | null>(null);
  const [pyramid, setPyramid] = useState(false);
  const webgl = useWebGL();

  useEffect(() => {
    if (!webgl) return;
    let gone = false;
    import("@/lib/home3d").then(({ mountHologram }) => {
      if (gone || !stage.current) return;
      ctl.current = mountHologram(stage.current, plan);
    });
    return () => { gone = true; ctl.current?.dispose(); ctl.current = null; };
  }, [plan, webgl]);

  if (!webgl) return <p className="muted">Your browser can’t show 3D. Try the 2D plan.</p>;
  const toggle = () => { const on = !pyramid; setPyramid(on); ctl.current?.setPyramid(on); };
  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <button type="button" className={`chip${!pyramid ? " on" : ""}`} onClick={() => pyramid && toggle()}>✨ Hologram</button>
        <button type="button" className={`chip${pyramid ? " on" : ""}`} onClick={() => !pyramid && toggle()}>🔺 Pyramid mode</button>
      </div>
      <Stage stageRef={stage} dark>
        <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg, rgba(0,255,255,.05) 0 1px, transparent 1px 3px)", mixBlendMode: "screen" }} />
        <span className="sr-only">Hologram of {title}</span>
      </Stage>
      <p className="small muted" style={{ margin: "6px 0 0" }}>
        {pyramid
          ? "Go full screen on a phone or tablet, lay it flat, and stand a clear pyramid (tip down) on the centre: the home floats inside it."
          : "A holographic view of the layout, turning slowly. Use Pyramid mode with a phone-top hologram pyramid."}
      </p>
    </div>
  );
}
