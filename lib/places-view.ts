// Server-only: turn stored places into what the map shows, merging TikTok captions/thumbnails from the
// static cache (content/social.json, built by `npm run social:refresh`) and the database (the pipeline).
import "server-only";
import staticManifest from "@/content/social.json";
import { toMapPlace, type MapPlace, type PlaceRecord, type SocialManifest } from "./places-model";
import type { PlaceStore } from "./places-store";

export async function videoManifest(store: PlaceStore): Promise<SocialManifest> {
  const items: NonNullable<SocialManifest["items"]> = { ...(staticManifest as SocialManifest).items };
  for (const v of await store.listVideos()) {
    const cur = items[v.videoId] ?? {};
    items[v.videoId] = {
      label: cur.label ?? v.label ?? undefined,
      thumb: cur.thumb ?? (v.hasThumb ? `/social-thumb/${v.videoId}` : undefined),
    };
  }
  return { items };
}

export async function toMapPlaces(store: PlaceStore, records: PlaceRecord[]): Promise<MapPlace[]> {
  const manifest = await videoManifest(store);
  return records.map((r) => toMapPlace(r, manifest));
}
