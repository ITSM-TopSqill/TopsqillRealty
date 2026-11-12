import { videoEmbed, tourEmbed } from "@/lib/embeds";
import { Map3D } from "./Map3D";

/**
 * The walkthrough video, the 3D tour and the 3D neighbourhood map of a
 * listing. Each section shows only when the listing has it. Embeds come only
 * from known hosts, sandboxed so they can't navigate the page away.
 */
export function ListingExtras({ title, videoUrl, tourUrl, lat, lng, locality, approximate = false }: {
  title: string; videoUrl?: string | null; tourUrl?: string | null; lat?: number | null; lng?: number | null; locality: string;
  /** The seller chose "approximate area only": an area, not a pin. */
  approximate?: boolean;
}) {
  const video = videoEmbed(videoUrl);
  const tour = tourEmbed(tourUrl);
  const hasMap = typeof lat === "number" && typeof lng === "number";
  if (!video && !tour && !hasMap) return null;
  return (
    <div className="card pad col" style={{ gap: 18, marginBottom: 16 }}>
      {tour ? (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>🧭 3D tour</h2>
          <Frame src={tour.embed} title={`3D tour of ${title}`} xr />
          <p className="small muted" style={{ marginTop: 6 }}>Drag to look around; use the arrows or click the floor to walk through.</p>
        </section>
      ) : null}
      {video ? (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>🎬 Video walkthrough</h2>
          <Frame src={video.embed} title={`Video of ${title}`} />
        </section>
      ) : null}
      {hasMap ? (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>🗺️ Neighbourhood in 3D</h2>
          <Map3D lat={lat!} lng={lng!} label={locality} approximate={approximate} />
        </section>
      ) : null}
    </div>
  );
}

function Frame({ src, title, xr = false }: { src: string; title: string; xr?: boolean }) {
  return (
    <div style={{ position: "relative", aspectRatio: "16/9", borderRadius: 14, overflow: "hidden", background: "#000" }}>
      <iframe src={src} title={title} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
        allow={`accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen${xr ? "; xr-spatial-tracking; web-share" : ""}`}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
    </div>
  );
}
