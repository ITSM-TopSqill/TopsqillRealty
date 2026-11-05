import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap" style={{ display: "grid", placeItems: "center", minHeight: "70vh", textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 32 }}>We couldn’t find that page</h1>
        <p className="muted" style={{ margin: "8px 0 18px" }}>It may have been removed, or the link may be wrong.</p>
        <Link href="/" className="btn btn-ai">Back to Topsqill.ai</Link>
      </div>
    </main>
  );
}
