import type { Metadata } from "next";
import { MapView } from "@/components/map-view";
import { getContent } from "@/lib/content";
import { getMapPlaces } from "@/lib/places-data";

// Server actions on this page may run the enrichment pipeline (web lookups), so allow up to a minute.
export const maxDuration = 60;

export function generateMetadata(): Metadata {
  const { name } = getContent().profile;
  const description = "A map of things to do in cities, each linked to the TikToks and posts that show it off.";
  return { title: "Map", description, openGraph: { title: `Map · ${name}`, description } };
}

export default async function MapPage() {
  // Places come from the database (Neon) when DATABASE_URL is set; see lib/places-db.ts.
  const { places, storage } = await getMapPlaces();
  return (
    <div className="pt-2">
      <h1 className="sr-only">Things to do map</h1>
      <MapView places={places} storage={storage} />
    </div>
  );
}
