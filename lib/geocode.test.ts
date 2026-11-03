import { describe, expect, it, vi } from "vitest";
import { categoryFor, distanceMeters, findExisting, parseNominatim, parsePhoton, searchPlaces } from "./geocode";

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
