"use client";

import Link from "next/link";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="wrap" style={{ display: "grid", placeItems: "center", minHeight: "70vh", textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 30 }}>Something went wrong</h1>
        <p className="muted" style={{ margin: "8px 0 18px" }}>Please try again. If it keeps happening, let us know.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn btn-ai" onClick={reset}>Try again</button>
          <Link href="/" className="btn btn-g">Go home</Link>
        </div>
      </div>
    </main>
  );
}
