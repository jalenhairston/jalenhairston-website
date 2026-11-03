import { describe, expect, it, vi } from "vitest";
import { categoryFor, distanceMeters, findExisting, mergeResults, parseGooglePlaces, parseNominatim, parsePhoton, searchPlaces } from "./geocode";

const photon = {
  features: [
    {
      geometry: { coordinates: [-71.0560033, 42.3632431] },
      properties: { name: "Neptune Oyster", osm_key: "amenity", osm_value: "restaurant", street: "Salem Street", housenumber: "63", city: "Boston", state: "Massachusetts", osm_type: "N", osm_id: "4418911292" },
    },
    { geometry: { coordinates: [-73.5, 40.6] }, properties: { osm_key: "highway", osm_value: "proposed" } }, // no name: dropped
  ],
};

describe("categoryFor", () => {
  it("maps common OpenStreetMap tags", () => {
    expect(categoryFor("amenity", "restaurant")).toBe("food");
    expect(categoryFor("amenity", "cafe")).toBe("coffee");
    expect(categoryFor("amenity", "pub")).toBe("drinks");
    expect(categoryFor("shop", "clothes")).toBe("shopping");
    expect(categoryFor("shop", "bakery")).toBe("food");
    expect(categoryFor("tourism", "museum")).toBe("culture");
    expect(categoryFor("leisure", "park")).toBe("outdoors");
    expect(categoryFor(undefined, undefined)).toBe("other");
  });
});

describe("parsePhoton", () => {
  it("returns named features with address detail, city and category", () => {
    const [r, ...rest] = parsePhoton(photon);
    expect(rest).toHaveLength(0);
    expect(r).toMatchObject({ name: "Neptune Oyster", city: "Boston", category: "food", lat: 42.3632431, lng: -71.0560033 });
    expect(r.detail).toBe("63 Salem Street, Boston, Massachusetts");
  });
  it("tolerates garbage", () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({ features: [{}] })).toEqual([]);
  });
});

describe("parseNominatim", () => {
  it("reads name, city and coordinates", () => {
    const [r] = parseNominatim([{ lat: "42.36", lon: "-71.05", name: "Mike's Pastry", category: "shop", type: "bakery", address: { house_number: "300", road: "Hanover Street", city: "Boston", state: "Massachusetts" } }]);
    expect(r).toMatchObject({ name: "Mike's Pastry", city: "Boston", category: "food", lat: 42.36, lng: -71.05 });
    expect(r.detail).toBe("300 Hanover Street, Boston, Massachusetts");
  });
});

describe("findExisting", () => {
  const saved = [{ name: "Mike's Pastry", lat: 42.3642, lng: -71.0542 }];
  const result = (name: string, lat: number, lng: number) => ({ id: "x", name, detail: "", city: "", category: "food", lat, lng });
  it("matches by proximity or by same name nearby", () => {
    expect(findExisting(result("Something else", 42.36422, -71.05421), saved)).toBe(saved[0]); // ~2m away
    expect(findExisting(result("Next door shop", 42.36435, -71.0542), saved)).toBeUndefined(); // ~15m+ away, different name
    expect(findExisting(result("Mike's Pastry Inc", 42.3650, -71.0550), saved)).toBe(saved[0]); // name contains, ~120m
  });
  it("does not match a same-named place in another city, or a different place down the street", () => {
    expect(findExisting(result("Mike's Pastry", 40.7, -74.0), saved)).toBeUndefined();
    expect(findExisting(result("Modern Pastry", 42.3650, -71.0550), saved)).toBeUndefined();
  });
  it("measures distance sensibly", () => {
    expect(Math.round(distanceMeters({ lat: 42.0, lng: -71.0 }, { lat: 42.001, lng: -71.0 }))).toBe(111);
  });
});

describe("searchPlaces", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
  it("uses Photon, ignores too-short queries, and caches repeats", async () => {
    const f = vi.fn<(u: URL | string) => Promise<Response>>(async () => ok(photon));
    expect(await searchPlaces("n", { lat: 42, lng: -71 }, { fetchImpl: f as unknown as typeof fetch })).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    const a = await searchPlaces("neptune oyster", { lat: 42.35, lng: -71.07 }, { fetchImpl: f as unknown as typeof fetch });
    const b = await searchPlaces("Neptune Oyster", { lat: 42.36, lng: -71.06 }, { fetchImpl: f as unknown as typeof fetch });
    expect(a[0].name).toBe("Neptune Oyster");
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("photon.komoot.io");
  });
  it("falls back to Nominatim when Photon fails, and throws when both fail", async () => {
    const f = vi.fn(async (url: URL | string) =>
      String(url).includes("photon") ? ({ ok: false, status: 503 } as Response) : ok([{ lat: "1", lon: "2", name: "Fallback Cafe", category: "amenity", type: "cafe" }]),
    );
    const r = await searchPlaces("fallback cafe", { lat: 10, lng: 10 }, { fetchImpl: f as unknown as typeof fetch });
    expect(r[0]).toMatchObject({ name: "Fallback Cafe", category: "coffee" });
    const dead = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    await expect(searchPlaces("nothing works", { lat: 20, lng: 20 }, { fetchImpl: dead as unknown as typeof fetch })).rejects.toThrow();
  });
});

describe("mergeResults", () => {
  const r = (id: string, name: string, lat: number, lng: number) => ({ id, name, detail: "", city: "", category: "food", lat, lng });
  it("drops the same spot and the same name nearby, keeping the first", () => {
    const merged = mergeResults(
      [r("a", "Tatte Bakery", 42.35, -71.08)],
      [r("b", "Tatte Bakery", 42.3505, -71.0805), r("c", "Tatte Bakery", 42.35004, -71.08), r("d", "Other Cafe", 42.36, -71.09)],
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "d"]);
  });
  it("keeps same-named places that are far apart", () => {
    expect(mergeResults([r("a", "Starbucks", 42.35, -71.08)], [r("b", "Starbucks", 42.4, -71.2)])).toHaveLength(2);
  });
});

describe("parseGooglePlaces", () => {
  it("reads the Places API (New) shape", () => {
    const [x] = parseGooglePlaces({
      places: [
        {
          id: "ChIJabc",
          displayName: { text: "Lola 42" },
          formattedAddress: "22 Liberty Dr, Boston, MA 02210, USA",
          location: { latitude: 42.3546, longitude: -71.0453 },
          types: ["bar", "restaurant", "point_of_interest"],
          addressComponents: [{ longText: "Boston", types: ["locality", "political"] }],
        },
        { displayName: { text: "No location" } },
      ],
    });
    expect(x).toMatchObject({ id: "google:ChIJabc", name: "Lola 42", city: "Boston", category: "drinks", lat: 42.3546, lng: -71.0453 });
    expect(x.detail).toBe("22 Liberty Dr, Boston, MA 02210");
  });
});

describe("searchPlaces strategy", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
  const feat = (name: string, lng: number, lat: number) => ({ geometry: { coordinates: [lng, lat] }, properties: { name, osm_key: "amenity", osm_value: "cafe", city: "Boston" } });

  it("limits Photon to the map's region and also tries the query with the city, merging both", async () => {
    const calls: string[] = [];
    const f = vi.fn<(u: URL | string) => Promise<Response>>(async (u) => {
      calls.push(String(u));
      return ok({ features: String(u).includes("Boston") ? [feat("Zaku Izakaya", -71.0798, 42.3419)] : [feat("Zaku Sushi", -71.2, 42.5)] });
    });
    const r = await searchPlaces("zaku", { lat: 42.355, lng: -71.07, city: "Boston" }, { fetchImpl: f as unknown as typeof fetch });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.includes("bbox="))).toBe(true);
    expect(calls.some((c) => c.includes("q=zaku+Boston"))).toBe(true);
    expect(r.map((x) => x.name).sort()).toEqual(["Zaku Izakaya", "Zaku Sushi"]);
  });

  it("retries without bounds when the region has no match", async () => {
    const calls: string[] = [];
    const f = vi.fn<(u: URL | string) => Promise<Response>>(async (u) => {
      calls.push(String(u));
      return ok({ features: String(u).includes("bbox=") ? [] : [feat("Far Away Cafe", 10, 50)] });
    });
    const r = await searchPlaces("far away", { lat: 1, lng: 1 }, { fetchImpl: f as unknown as typeof fetch });
    expect(r[0].name).toBe("Far Away Cafe");
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain("bbox=");
  });

  it("uses Google first when a key is configured, and falls back to OpenStreetMap if Google fails", async () => {
    const google = vi.fn<(u: URL | string, init?: RequestInit) => Promise<Response>>(async (u, init) => {
      if (String(u).includes("googleapis")) {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY");
        expect(JSON.parse(String(init?.body)).textQuery).toBe("tony and elaines");
        return ok({ places: [{ id: "1", displayName: { text: "Tony & Elaine's" }, location: { latitude: 42.3656, longitude: -71.0581 }, types: ["restaurant"] }] });
      }
      return ok({ features: [feat("OSM Result", -71, 42)] });
    });
    const g = await searchPlaces("tony and elaines", { lat: 42.36, lng: -71.06 }, { fetchImpl: google as unknown as typeof fetch, googleKey: "KEY" });
    expect(g[0]).toMatchObject({ name: "Tony & Elaine's", category: "food" });

    const broken = vi.fn<(u: URL | string) => Promise<Response>>(async (u) =>
      String(u).includes("googleapis") ? ({ ok: false, status: 403 } as Response) : ok({ features: [feat("OSM Result", -71, 42)] }),
    );
    const fb = await searchPlaces("some place xyz", { lat: 42.36, lng: -71.06 }, { fetchImpl: broken as unknown as typeof fetch, googleKey: "BAD" });
    expect(fb[0].name).toBe("OSM Result");
  });
});
