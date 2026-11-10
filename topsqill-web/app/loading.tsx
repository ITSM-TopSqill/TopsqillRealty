"use client";

import { usePathname } from "next/navigation";
import { Shell } from "@/components/Shell";

/**
 * Shown the moment a tab is clicked, while the server prepares the page.
 * Without it the old page stayed on screen with no sign anything was
 * happening. Next.js also prefetches this shell for links on screen, so it
 * appears instantly.
 */
/** Pages with their own layout, which should not flash the member navigation. */
const NO_SHELL = ["/signin", "/signup", "/onboarding", "/admin"];

export default function Loading() {
  const pathname = usePathname();
  if (NO_SHELL.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return <div className="wrap" aria-busy="true" aria-label="Loading" />;
  }
  return (
    <Shell user={undefined} current={pathname}>
      <div aria-busy="true" aria-label="Loading">
        <div className="skel" style={{ height: 30, width: 220, marginBottom: 16 }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="card pad" style={{ marginBottom: 16 }}>
            <div className="skel" style={{ height: 18, width: "40%", marginBottom: 12 }} />
            <div className="skel" style={{ height: 12, width: "90%", marginBottom: 8 }} />
            <div className="skel" style={{ height: 12, width: "70%" }} />
          </div>
        ))}
      </div>
    </Shell>
  );
}
