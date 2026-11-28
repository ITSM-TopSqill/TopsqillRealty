"use client";

import { useState } from "react";
import { CompetitorDiscovery } from "@/components/CompetitorDiscovery";
import { CompetitorSearch } from "@/components/CompetitorSearch";
import { LandingPageAnalyser } from "@/components/LandingPageAnalyser";
import type { Competitor } from "@/lib/types";

/** Ties competitor selection (Module 1) to ad search/analysis (Modules 2-3) and landing-page analysis (Module 4): picking a tracked competitor prefills the search and links any watch or analysis back to it. */
export function CompetitiveIntelligenceWorkspace() {
  const [selected, setSelected] = useState<Competitor | null>(null);

  return (
    <div className="col" style={{ gap: 16 }}>
      <CompetitorDiscovery onSelect={setSelected} />
      <CompetitorSearch key={selected?.id ?? "none"} initialQuery={selected?.name} competitorId={selected?.id} competitorName={selected?.name} />
      <LandingPageAnalyser key={`lp-${selected?.id ?? "none"}`} competitorId={selected?.id} competitorName={selected?.name} />
    </div>
  );
}
