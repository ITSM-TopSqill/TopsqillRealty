"use client";

import { useEffect, useRef, useState } from "react";

type Scene = { caption: string; sub?: string };
const W = 540, H = 960, PER = 3.2;   // 9:16, seconds per scene

/**
 * The campaign's reel as a real video: the listing's photos with slow camera
 * moves, the reel captions, progress bars like Stories, and a closing card.
 * Plays here, and "Download video" records it to a file (MP4 where the
 * browser can, otherwise WebM) with an optional soft music bed.
 */
export function ReelPlayer({ scenes, photos, price, title }: { scenes: Scene[]; photos: string[]; price: string; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const imgs = useRef<(HTMLImageElement | null)[]>([]);
  const [ready, setReady] = useState(false);
  const [clean, setClean] = useState(true);      // photos that allow recording (CORS)
  const [state, setState] = useState<"idle" | "playing" | "recording">("idle");
  const [music, setMusic] = useState(true);
  const [error, setError] = useState("");
  const raf = useRef(0);
  const total = scenes.length * PER;

  // Photos load with CORS so the video can be recorded; if a photo refuses, it's shown but recording is off.
  useEffect(() => {
    let live = true;
    const list = photos.length ? photos : [""];
    Promise.all(list.map((src) => new Promise<{ img: HTMLImageElement | null; cors: boolean }>((resolve) => {
      if (!src) return resolve({ img: null, cors: true });
      const a = new Image(); a.crossOrigin = "anonymous";
      a.onload = () => resolve({ img: a, cors: true });
      a.onerror = () => { const b = new Image(); b.onload = () => resolve({ img: b, cors: false }); b.onerror = () => resolve({ img: null, cors: true }); b.src = src; };
      a.src = src;
    }))).then((r) => { if (!live) return; imgs.current = r.map((x) => x.img); setClean(r.every((x) => x.cors)); setReady(true); draw(0); });
    return () => { live = false; cancelAnimationFrame(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.join("|")]);

  function draw(t: number) {
    const x = canvas.current?.getContext("2d");
    if (!x) return;
    const i = Math.min(scenes.length - 1, Math.floor(t / PER));
    const local = (t - i * PER) / PER;
    const img = imgs.current.length ? imgs.current[i % imgs.current.length] : null;
    x.fillStyle = "#14112b"; x.fillRect(0, 0, W, H);
    if (img) {
      const zoom = 1.08 + 0.1 * (i % 2 ? 1 - local : local);
      const s = Math.max(W / img.width, H / img.height) * zoom;
      const dw = img.width * s, dh = img.height * s;
      const pan = (i % 3 - 1) * 30 * local;
      x.globalAlpha = Math.min(1, local * 4 + 0.15);
      x.drawImage(img, (W - dw) / 2 + pan, (H - dh) / 2, dw, dh);
      x.globalAlpha = 1;
    } else {
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#1F1D33"); g.addColorStop(1, "#2F6FD0"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
    const shade = x.createLinearGradient(0, H * 0.45, 0, H); shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,.78)");
    x.fillStyle = shade; x.fillRect(0, 0, W, H);
    // Stories-style progress bars
    for (let k = 0; k < scenes.length; k++) {
      const bw = (W - 40 - (scenes.length - 1) * 6) / scenes.length, bx = 20 + k * (bw + 6);
      x.fillStyle = "rgba(255,255,255,.35)"; x.fillRect(bx, 22, bw, 4);
      x.fillStyle = "#fff"; x.fillRect(bx, 22, bw * (k < i ? 1 : k === i ? local : 0), 4);
    }
    // Caption: slides up and fades in
    const sc = scenes[i];
    const rise = Math.min(1, local * 3.2), ease = 1 - Math.pow(1 - rise, 3);
    x.globalAlpha = ease; x.fillStyle = "#fff"; x.textAlign = "left";
    x.font = '800 46px "Bricolage Grotesque", system-ui, sans-serif';
    const lines = wrap(x, sc.caption, W - 72);
    const baseY = H - 210 + (1 - ease) * 40 - (lines.length - 1) * 52;
    lines.forEach((ln, n) => x.fillText(ln, 36, baseY + n * 52));
    if (sc.sub) { x.font = "500 26px system-ui, sans-serif"; x.fillStyle = "rgba(255,255,255,.9)"; wrap(x, sc.sub, W - 72).slice(0, 2).forEach((ln, n) => x.fillText(ln, 36, baseY + lines.length * 52 + 8 + n * 34)); }
    x.globalAlpha = 1;
    if (i === scenes.length - 1) {
      x.fillStyle = "#fff"; roundRect(x, 36, H - 112, 300, 62, 31); x.fill();
      x.fillStyle = "#1F1D33"; x.font = "800 26px system-ui, sans-serif"; x.fillText("Book a site visit →", 58, H - 72);
    }
    x.fillStyle = "rgba(255,255,255,.85)"; x.font = "700 22px system-ui, sans-serif"; x.textAlign = "right"; x.fillText("Topsqill.ai", W - 30, 62);
    x.textAlign = "left"; x.font = "800 30px system-ui, sans-serif"; x.fillText(price, 36, 74);
  }

  /** A quiet two-chord pad, so the reel isn't silent (only while playing or recording). */
  function startMusic() {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ac = new AC();
    const out = ac.createGain(); out.gain.value = 0; out.gain.linearRampToValueAtTime(0.12, ac.currentTime + 1.2);
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.connect(out);
    const dest = ac.createMediaStreamDestination(); out.connect(ac.destination); out.connect(dest);
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
    const oscs: OscillatorNode[] = [];
    chords[0].forEach((_, v) => {
      const o = ac.createOscillator(); o.type = "triangle";
      chords.forEach((c, k) => o.frequency.setValueAtTime(c[v], ac.currentTime + k * (total / chords.length)));
      const g = ac.createGain(); g.gain.value = 0.33; o.connect(g); g.connect(lp); o.start(); oscs.push(o);
    });
    return { stream: dest.stream, stop: () => { out.gain.linearRampToValueAtTime(0, ac.currentTime + 0.4); setTimeout(() => { oscs.forEach((o) => o.stop()); ac.close(); }, 500); } };
  }

  function run(record: boolean) {
    setError("");
    cancelAnimationFrame(raf.current);
    const m = music ? startMusic() : null;
    let rec: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    if (record) {
      const stream = canvas.current!.captureStream(30);
      m?.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      const type = ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      if (!type) { setError("This browser can’t record video. Try Chrome or Safari."); m?.stop(); return; }
      rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: type.split(";")[0] });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${title.replace(/[^\w]+/g, "-").slice(0, 40)}-reel.${type.startsWith("video/mp4") ? "mp4" : "webm"}`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      };
      rec.start();
    }
    setState(record ? "recording" : "playing");
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      draw(Math.min(t, total - 0.001));
      if (t < total + 0.6) raf.current = requestAnimationFrame(tick);
      else { m?.stop(); rec?.stop(); setState("idle"); }
    };
    tick();
  }

  return (
    <div className="card pad">
      <b className="small">🎬 Reel ({scenes.length} scenes, {Math.round(total)} s)</b>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, alignItems: "flex-start" }}>
        <canvas ref={canvas} width={W} height={H} style={{ width: 216, aspectRatio: "9/16", borderRadius: 14, background: "#14112b", display: "block" }} aria-label={`Reel: ${scenes.map((s) => s.caption).join(". ")}`} />
        <div className="col" style={{ gap: 8, minWidth: 160, flex: 1 }}>
          <button type="button" className="btn btn-ai sm" disabled={!ready || state !== "idle"} onClick={() => run(false)}>{state === "playing" ? "Playing…" : "▶ Play reel"}</button>
          <button type="button" className="btn btn-o sm" disabled={!ready || state !== "idle" || !clean} onClick={() => run(true)}
            title={clean ? undefined : "The photos' server doesn't allow recording them"}>{state === "recording" ? "Recording… (plays once)" : "⬇ Download video"}</button>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} /> Soft music</label>
          {!clean ? <p className="small muted" style={{ margin: 0 }}>Download needs the photo storage to allow it (CORS). Playing works.</p> : null}
          {error ? <p className="small error" style={{ margin: 0 }}>{error}</p> : null}
          <ol className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{scenes.map((s, i) => <li key={i}><b>{s.caption}</b>{s.sub ? <span className="muted"> · {s.sub}</span> : null}</li>)}</ol>
        </div>
      </div>
    </div>
  );
}

function wrap(x: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(/\s+/); const out: string[] = []; let line = "";
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (x.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line);
  return out.slice(0, 3);
}
function roundRect(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath();
}
