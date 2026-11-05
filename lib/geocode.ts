// Place search for the "Add place" flow. Photon (autocomplete-friendly, OpenStreetMap data) first,
// Nominatim as a fallback; both are free, keyless and allow browser (CORS) requests.
// Framework-free so it can be unit-tested.

export type PlaceResult = {
  id: string;
  name: string;
  /** "63 Salem Street, Boston, Massachusetts" */
  detail: string;
  city: string;
  category: string;
  lat: number;
  lng: number;
};

type Near = { lat: number; lng: number; /** City of the saved place nearest the map centre; appended to the query as a second variant. */ city?: string };

/** Map an OpenStreetMap key/value to one of the app's categories. */
export function categoryFor(key?: string, value?: string): string {
  const v = value ?? "";
  if (key === "amenity") {
    if (["restaurant", "fast_food", "food_court", "ice_cream"].includes(v)) return "food";
    if (["cafe", "coffee_shop"].includes(v)) return "coffee";
    if (["bar", "pub", "biergarten", "wine_bar"].includes(v)) return "drinks";
    if (["nightclub", "casino"].includes(v)) return "nightlife";
    if (["theatre", "cinema", "arts_centre", "library", "place_of_worship"].includes(v)) return "culture";
    return "other";
  }
  if (key === "shop") return v === "bakery" || v === "pastry" || v === "confectionery" ? "food" : "shopping";
  if (key === "tourism") return ["museum", "gallery", "attraction", "zoo", "aquarium", "artwork", "viewpoint"].includes(v) ? (v === "viewpoint" ? "outdoors" : "culture") : "other";
  if (key === "leisure") return ["park", "garden", "nature_reserve", "playground", "beach_resort"].includes(v) ? "outdoors" : "other";
  if (key === "historic") return "culture";
  if (key === "natural") return "outdoors";
  if (key === "highway") return "outdoors";
  return "other";
}

/** Great-circle distance in metres. */
export function distanceMeters(a: Near, b: Near): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/** An already-saved place this result is (almost certainly) the same as: on the same spot (<15m), or the same name nearby. */
export function findExisting<T extends { name: string; lat: number; lng: number }>(r: PlaceResult, places: T[]): T | undefined {
  const rn = norm(r.name);
  return places.find((p) => {
    const d = distanceMeters(r, p);
    if (d < 15) return true; // the very same spot; neighbours on a busy street are different places
    const pn = norm(p.name);
    return d < 500 && rn.length >= 4 && pn.length >= 4 && (rn.includes(pn) || pn.includes(rn));
  });
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
};

export function parsePhoton(json: unknown): PlaceResult[] {
  const features = ((json as { features?: PhotonFeature[] })?.features ?? []) as PhotonFeature[];
  const out: PlaceResult[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!p.name || typeof lat !== "number" || typeof lng !== "number") continue;
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const city = p.city ?? p.locality ?? p.district ?? p.county ?? p.state ?? "";
    out.push({
      id: `photon:${p.osm_type ?? ""}${p.osm_id ?? ""}:${lat.toFixed(5)},${lng.toFixed(5)}`,
      name: p.name,
      detail: [street, city, p.state && p.state !== city ? p.state : undefined].filter(Boolean).join(", "),
      city,
      category: categoryFor(p.osm_key, p.osm_value),
      lat,
      lng,
    });
  }
  return out;
}

type NominatimItem = {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  osm_id?: number;
  address?: Record<string, string | undefined>;
};

export function parseNominatim(json: unknown): PlaceResult[] {
  const items = (Array.isArray(json) ? json : []) as NominatimItem[];
  const out: PlaceResult[] = [];
  for (const it of items) {
    const lat = Number(it.lat);
    const lng = Number(it.lon);
    const name = it.name || it.display_name?.split(",")[0]?.trim();
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const a = it.address ?? {};
    const city = a.city ?? a.town ?? a.village ?? a.suburb ?? a.county ?? "";
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    out.push({
      id: `nominatim:${it.osm_id ?? ""}:${lat.toFixed(5)},${lng.toFixed(5)}`,
      name,
      detail: [street, city, a.state].filter(Boolean).join(", "),
      city,
      category: categoryFor(it.category, it.type),
      lat,
      lng,
    });
  }
  return out;
}

/** Combine result lists, dropping duplicates (the same spot, or the same name nearby). First occurrence wins. */
export function mergeResults(...lists: PlaceResult[][]): PlaceResult[] {
  const out: PlaceResult[] = [];
  for (const r of lists.flat()) {
    const rn = norm(r.name);
    const dup = out.some((o) => {
      const d = distanceMeters(o, r);
      return d < 15 || (d < 200 && rn.length >= 4 && (norm(o.name) === rn));
    });
    if (!dup) out.push(r);
  }
  return out;
}

const GOOGLE_TYPES: [RegExp, string][] = [
  [/^(restaurant|food|meal_takeaway|meal_delivery|bakery|ice_cream_shop|pizza_restaurant|.*_restaurant)$/, "food"],
  [/^(cafe|coffee_shop|tea_house)$/, "coffee"],
  [/^(bar|pub|wine_bar|liquor_store)$/, "drinks"],
  [/^(night_club|casino)$/, "nightlife"],
  [/^(museum|art_gallery|tourist_attraction|historical_landmark|library|church|performing_arts_theater|movie_theater|cultural_landmark)$/, "culture"],
  [/^(park|national_park|garden|beach|hiking_area|campground|zoo|aquarium)$/, "outdoors"],
  [/^(store|clothing_store|shopping_mall|book_store|shoe_store|jewelry_store|department_store|gift_shop|market|supermarket)$/, "shopping"],
];

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  addressComponents?: { longText?: string; types?: string[] }[];
};

/** Google Places API (New) `places:searchText` response -> results. */
export function parseGooglePlaces(json: unknown): PlaceResult[] {
  const places = ((json as { places?: GooglePlace[] })?.places ?? []) as GooglePlace[];
  const out: PlaceResult[] = [];
  for (const p of places) {
    const name = p.displayName?.text;
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (!name || typeof lat !== "number" || typeof lng !== "number") continue;
    const city =
      p.addressComponents?.find((c) => c.types?.includes("locality"))?.longText ??
      p.addressComponents?.find((c) => c.types?.includes("sublocality") || c.types?.includes("postal_town"))?.longText ??
      "";
    const category = (p.types ?? []).map((t) => GOOGLE_TYPES.find(([re]) => re.test(t))?.[1]).find(Boolean) ?? "other";
    out.push({
      id: `google:${p.id ?? `${lat.toFixed(5)},${lng.toFixed(5)}`}`,
      name,
      detail: (p.formattedAddress ?? "").replace(/, (USA|United States)$/, ""),
      city,
      category,
      lat,
      lng,
    });
  }
  return out;
}

const cache = new Map<string, PlaceResult[]>();
const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

type Opts = { signal?: AbortSignal; fetchImpl?: typeof fetch; googleKey?: string };

async function photon(q: string, near: Near, f: typeof fetch, signal?: AbortSignal, bounded = true): Promise<PlaceResult[]> {
  const u = new URL("https://photon.komoot.io/api/");
  u.searchParams.set("q", q);
  u.searchParams.set("lat", String(near.lat));
  u.searchParams.set("lon", String(near.lng));
  u.searchParams.set("limit", "7");
  u.searchParams.set("lang", "en");
  // Search where the map is looking (~±45km), not the whole planet: far fewer wrong-continent matches.
  if (bounded) u.searchParams.set("bbox", [near.lng - 0.5, near.lat - 0.4, near.lng + 0.5, near.lat + 0.4].join(","));
  const res = await f(u, { signal });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  return parsePhoton(await res.json());
}

async function nominatim(q: string, near: Near, f: typeof fetch, signal?: AbortSignal): Promise<PlaceResult[]> {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("limit", "7");
  u.searchParams.set("viewbox", `${near.lng - 1},${near.lat + 1},${near.lng + 1},${near.lat - 1}`);
  const res = await f(u, { signal });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return parseNominatim(await res.json());
}

/** Google Places API (New). Needs a browser key restricted to this site's domain (see docs/map-poc-spec.md). */
async function google(q: string, near: Near, f: typeof fetch, key: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const res = await f("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": key,
      "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents",
    },
    body: JSON.stringify({
      textQuery: q,
      maxResultCount: 7,
      locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } },
    }),
  });
  if (!res.ok) throw new Error(`google ${res.status}`);
  return parseGooglePlaces(await res.json());
}

/**
 * Search by name, biased towards `near`. Order: Google Places (only if a key is configured), then Photon limited
 * to the map's region (plain query plus "query + city", in parallel and merged), then Photon unbounded, then
 * Nominatim. Throws only if every provider fails.
 */
export async function searchPlaces(query: string, near: Near, opts: Opts = {}): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = `${q.toLowerCase()}|${near.lat.toFixed(1)},${near.lng.toFixed(1)}|${near.city ?? ""}|${opts.googleKey ? "g" : ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const f = opts.fetchImpl ?? fetch;
  const { signal } = opts;
  const aborted = () => signal?.aborted === true;

  let results: PlaceResult[] | undefined;
  if (opts.googleKey) {
    try {
      const g = await google(q, near, f, opts.googleKey, signal);
      if (g.length > 0) results = g;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
    }
  }
  if (!results) {
    try {
      const variants = [q];
      if (near.city && !norm(q).includes(norm(near.city))) variants.push(`${q} ${near.city}`);
      const settled = await Promise.allSettled(variants.map((v) => photon(v, near, f, signal)));
      if (aborted()) throw abortError();
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (ok.length === 0) throw new Error("photon failed");
      results = mergeResults(...ok);
      if (results.length === 0) results = await photon(q, near, f, signal, false);
    } catch (e) {
      if ((e as Error).name === "AbortError" || aborted()) throw e;
      results = await nominatim(q, near, f, signal);
    }
  }
  if (cache.size >= 40) cache.delete(cache.keys().next().value as string);
  cache.set(key, results);
  return results;
}
