"use client";

import { useEffect, useRef, useState } from "react";
import { AMENITIES_LIST } from "@/lib/amenities";

/** A dropdown with a scrollable, checkable list of amenities, each with an icon. */
export function AmenitiesPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggle(label: string) {
    onChange(value.includes(label) ? value.filter((x) => x !== label) : [...value, label]);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="btn btn-o sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {value.length ? `${value.length} amenity${value.length === 1 ? "" : "ies"} selected` : "Choose amenities"} {open ? "▲" : "▼"}
      </button>
      {value.length ? (
        <div className="small muted" style={{ marginTop: 6 }}>{value.join(", ")}</div>
      ) : null}
      {open ? (
        <div className="card" style={{
          position: "absolute", zIndex: 20, top: "calc(100% + 6px)", left: 0, width: 280,
          maxHeight: 280, overflowY: "auto", padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,.15)",
        }}>
          {AMENITIES_LIST.map(([icon, label]) => (
            <label key={label} className="small" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", borderRadius: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={value.includes(label)} onChange={() => toggle(label)} />
              <span>{icon}</span>
              <span>{label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
