// Server-only: run the enrichment pipeline for one place and save what it finds.
import "server-only";
import sharp from "sharp";
import { enrichPlace, type EnrichDeps, type EnrichResult } from "./enrich";
import { embedFor } from "./social";
import type { PlaceRecord } from "./places-model";
import { getStore } from "./places-db";

export function enrichDeps(): EnrichDeps {
  return {
    fetch,
    braveKey: process.env.BRAVE_SEARCH_API_KEY || undefined,
    googleKey: process.env.GOOGLE_PLACES_SERVER_KEY || undefined,
    resizeThumb: async (bytes) => ({
      bytes: new Uint8Array(await sharp(bytes).resize(270, 480, { fit: "cover", position: "attention" }).jpeg({ quality: 72, mozjpeg: true }).toBuffer()),
      type: "image/jpeg",
    }),
  };
}

/**
 * End-to-end test stand-in (PLACES_ENRICH_FAKE=1): deterministic results, no network. Places whose name
 * contains "Quiet" find nothing, so the "nothing found" path can be tested too.
 */
function fakeEnrich(rec: PlaceRecord): EnrichResult {
  const ranAt = new Date().toISOString();
  if (rec.name.includes("Quiet")) return { videos: [], enrichment: { photos: "none", tiktok: 0, notes: ["fake: nothing found"], ranAt } };
  const id = "7000000000000000042";
  const url = `https://www.tiktok.com/@e2e/video/${id}`;
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
  const hasVideo = (rec.social.tiktok ?? []).some((u) => embedFor({ platform: "tiktok", url: u }));
  return {
    photos: rec.photos.length ? undefined : [{ src: "/headshot-placeholder.svg", alt: rec.name, credit: "fake" }],
    social: hasVideo ? undefined : { ...rec.social, tiktok: [...(rec.social.tiktok ?? []), url] },
    videos: hasVideo ? [] : [{ videoId: id, url, label: "@e2e · test video", thumb: png, thumbType: "image/png" }],
    enrichment: { photos: rec.photos.length ? "existing" : "commons", tiktok: hasVideo ? "existing" : 1, notes: ["fake: found what was missing"], ranAt },
  };
}

/** Enrich one place, save the results, then call `invalidate` so the map shows them. */
export async function runEnrichment(id: string, invalidate: () => void): Promise<PlaceRecord | null> {
  const store = getStore();
  const rec = await store.get(id);
  if (!rec) return null;
  const res = process.env.PLACES_ENRICH_FAKE === "1" ? fakeEnrich(rec) : await enrichPlace(rec, enrichDeps());
  for (const v of res.videos) await store.upsertVideo(v);
  const updated = await store.update(id, {
    photos: res.photos,
    social: res.social,
    googlePlaceId: res.googlePlaceId,
    enrichment: res.enrichment,
    enrichedAt: res.enrichment.ranAt,
  });
  try {
    invalidate();
  } catch (e) {
    console.error("enrichment: cache invalidation failed", e);
  }
  return updated;
}
