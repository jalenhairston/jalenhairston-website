// Cached read of all places for /map. The root layout requires routes to be fully static
// (ensureStatic = "navigation"), so this is prerendered into the page and refreshed on demand:
// server actions call updateTag(PLACES_TAG) after every write.
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import manifest from "@/content/social.json";
import { toMapPlace, type MapPlace } from "./places-model";
import { getStore } from "./places-db";

export const PLACES_TAG = "places";

export async function getMapPlaces(): Promise<{ places: MapPlace[]; storage: "database" | "memory" }> {
  "use cache";
  cacheTag(PLACES_TAG);
  cacheLife("max");
  const store = getStore();
  const rows = await store.list();
  return { places: rows.map((r) => toMapPlace(r, manifest)), storage: store.kind };
}
