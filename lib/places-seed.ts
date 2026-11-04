// Initial places for a fresh database (and the in-memory fallback): the real (non-sample) places from content/places.
import { getContent } from "./content";
import { placeInputSchema, socialFromLinks, type ValidPlaceInput } from "./places-model";

export function seedPlaces(): ValidPlaceInput[] {
  return getContent()
    .places.filter((p) => !p.sample)
    .map((p) =>
      placeInputSchema.parse({
        id: p.slug,
        name: p.name,
        address: null,
        description: p.body,
        social: socialFromLinks(p.links.map((l) => l.url)),
        latitude: p.lat,
        longitude: p.lng,
        city: p.city,
        category: p.category,
        photos: p.photos.map(({ src, alt, credit, creditUrl }) => ({ src, alt, ...(credit ? { credit } : {}), ...(creditUrl ? { creditUrl } : {}) })),
      }),
    );
}
