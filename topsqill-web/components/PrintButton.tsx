"use client";

export function PrintButton() {
  return <button className="btn btn-o sm" onClick={() => window.print()}>🖨 Print or save as PDF</button>;
}
