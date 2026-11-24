"use client";

import { useState } from "react";
import Link from "next/link";
import { Empty } from "@/components/ui";
import { CampaignForm } from "@/components/CampaignForm";
import { CreativeCampaignForm } from "@/components/CreativeCampaignForm";
import type { MyListing } from "@/lib/types";

const TABS = [
  { key: "listing", label: "From a listing" },
  { key: "creative", label: "From a creative" },
  { key: "video", label: "From a video" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** Three ways to start a campaign: promote a live listing, or run ads from a photo or video with no listing at all. */
export function NewCampaignTabs({ listings, preselect }: { listings: MyListing[]; preselect?: string }) {
  const [tab, setTab] = useState<Tab>("listing");

  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`chip ${tab === t.key ? "on" : ""}`} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "listing" ? (
        listings.length
          ? <CampaignForm listings={listings} preselect={preselect} />
          : <Empty title="Add a listing first" text="This option promotes one of your live listings."
              action={<Link href="/listings/new" className="btn btn-ai">Add a listing</Link>} />
      ) : null}
      {tab === "creative" ? <CreativeCampaignForm kind="creative" /> : null}
      {tab === "video" ? <CreativeCampaignForm kind="video" /> : null}
    </div>
  );
}
