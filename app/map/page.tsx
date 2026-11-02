import type { Metadata } from "next";
import { MapView, type MapPlace } from "@/components/map-view";
import { getContent } from "@/lib/content";

export function generateMetadata(): Metadata {
  const { name } = getContent().profile;
  const description = "A map of things to do in cities, each linked to the TikToks and posts that show it off.";
  return { title: "Map", description, openGraph: { title: `Map · ${name}`, description } };
}

export default function MapPage() {
  const places: MapPlace[] = getContent().places.map((p) => ({
    id: p.slug,
    name: p.name,
    city: p.city,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    description: p.body,
    links: p.links,
    userAdded: false,
  }));

  return (
    <div className="pt-2">
      <h1 className="sr-only">Things to do map</h1>
      <MapView places={places} />
    </div>
  );
}
