import { describe, expect, it } from "vitest";
import { enrichPlace, mentionsPlace, nameTokens, type EnrichDeps } from "./enrich";
import type { PlaceRecord } from "./places-model";

const place = (over: Partial<PlaceRecord> = {}): PlaceRecord => ({
  id: "p1",
  name: "Zaku Izakaya",
  address: null,
  description: "",
  social: {},
  latitude: 42.3419,
  longitude: -71.0798,
  city: "Boston",
  category: "food",
  photos: [],
  googlePlaceId: null,
  enrichedAt: null,
  enrichment: {},
  createdAt: "2026-11-04T00:00:00.000Z",
  updatedAt: "2026-11-04T00:00:00.000Z",
  ...over,
});

const commonsPage = (title: string, extra: Record<string, unknown> = {}) => ({
  title: `File:${title}.jpg`,
  index: 1,
  imageinfo: [{ thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}.jpg?x=1`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}.jpg`, mime: "image/jpeg", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } } }],
  ...extra,
});

const tiktokHtml = (id: string, author: string, desc: string) =>
  `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
    __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: { id, desc, author: { uniqueId: author }, video: { cover: `https://p16.tiktokcdn.com/${id}.jpeg?x-expires=1` } } } } },
  })}</script></html>`;

type Routes = { search?: unknown; geo?: unknown; google?: unknown; brave?: unknown; tiktok?: Record<string, string> };
function fakeFetch(r: Routes): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() }) as unknown as Response;
  const f = async (input: URL | RequestInfo) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("commons.wikimedia.org")) {
      const u = new URL(url);
      const body = u.searchParams.get("generator") === "geosearch" ? r.geo : r.search;
      return body === "error" ? json({}, false) : json({ query: { pages: Object.fromEntries(((body as unknown[]) ?? []).map((p, i) => [String(i), p])) } });
    }
    if (url.includes("places.googleapis.com")) return json(r.google ?? { places: [] });
    if (url.includes("api.search.brave.com")) return json(r.brave ?? { web: { results: [] } });
    if (url.includes("tiktokcdn.com")) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: new Headers({ "content-type": "image/jpeg" }) } as unknown as Response;
    const tt = url.match(/video\/(\d+)/)?.[1];
    if (tt && r.tiktok?.[tt]) return { ok: true, status: 200, text: async () => r.tiktok![tt] } as unknown as Response;
    return json({}, false);
  };
  return { fetch: f as unknown as typeof fetch, calls };
}

describe("name matching", () => {
  it("keeps distinctive words only", () => {
    expect(nameTokens("Zaku Izakaya", "Boston")).toEqual(["zaku", "izakaya"]);
    expect(nameTokens("Acorn Street", "Boston")).toEqual(["acorn"]);
    expect(nameTokens("Tony & Elaine's", "Boston")).toEqual(["tony", "elaine"]);
  });
  it("matches captions and titles that mention the place", () => {
    expect(mentionsPlace("📍zaku izakaya Cute little spot in south end", "Zaku Izakaya", "Boston")).toBe(true);
    expect(mentionsPlace("#ZakuIzakaya", "Zaku Izakaya", "Boston")).toBe(true);
    expect(mentionsPlace("best izakaya in Boston: Ittoku", "Zaku Izakaya", "Boston")).toBe(true); // half the words: lenient on purpose
    expect(mentionsPlace("Cheap sushi in the North End", "Zaku Izakaya", "Boston")).toBe(false);
    expect(mentionsPlace("Mike's Pastry, North End", "Mike's Pastry", "Boston")).toBe(true);
  });
});

describe("enrichPlace: photos", () => {
  it("uses Wikimedia Commons files whose title names the place (businesses ignore unrelated nearby photos)", async () => {
    const { fetch } = fakeFetch({
      search: [commonsPage("Zaku Izakaya - Boston, MA"), commonsPage("Some other restaurant")],
      geo: [commonsPage("Building next door", { coordinates: [{ lat: 42.34191, lon: -71.07981 }] })],
    });
    const r = await enrichPlace(place(), { fetch });
    expect(r.enrichment.photos).toBe("commons");
    expect(r.photos).toEqual([
      {
        src: "https://upload.wikimedia.org/thumb/Zaku%20Izakaya%20-%20Boston%2C%20MA.jpg",
        alt: "Zaku Izakaya",
        credit: "CC BY-SA 4.0 via Wikimedia Commons",
        creditUrl: "https://commons.wikimedia.org/wiki/File:Zaku%20Izakaya%20-%20Boston%2C%20MA.jpg",
      },
    ]);
  });

  it("lets landmarks use photos taken within 80m even without the name in the title", async () => {
    const { fetch } = fakeFetch({ search: [], geo: [commonsPage("Lake view, spring", { coordinates: [{ lat: 42.3419, lon: -71.0798 }] }), commonsPage("Far away", { coordinates: [{ lat: 42.35, lon: -71.07 }] })] });
    const r = await enrichPlace(place({ name: "Back Bay Fens", category: "outdoors" }), { fetch });
    expect(r.photos?.map((p) => p.src)).toEqual(["https://upload.wikimedia.org/thumb/Lake%20view%2C%20spring.jpg"]);
  });

  it("falls back to Google photos (served through /place-photo) when Commons has nothing", async () => {
    const { fetch, calls } = fakeFetch({
      search: [],
      geo: [],
      google: {
        places: [
          { id: "far", displayName: { text: "Zaku Izakaya" }, location: { latitude: 40.7, longitude: -74 } },
          { id: "ChIJzaku", displayName: { text: "Zaku Izakaya" }, location: { latitude: 42.342, longitude: -71.0799 }, photos: [{ name: "places/ChIJzaku/photos/a", authorAttributions: [{ displayName: "A. Diner", uri: "https://maps.google.com/u/1" }] }, { name: "places/ChIJzaku/photos/b" }] },
        ],
      },
    });
    const r = await enrichPlace(place(), { fetch, googleKey: "SERVER" });
    expect(r.googlePlaceId).toBe("ChIJzaku");
    expect(r.enrichment.photos).toBe("google");
    expect(r.photos).toEqual([
      { src: "/place-photo/ChIJzaku/0", alt: "Zaku Izakaya", credit: "Google Maps · A. Diner", creditUrl: "https://maps.google.com/u/1" },
      { src: "/place-photo/ChIJzaku/1", alt: "Zaku Izakaya", credit: "Google Maps" },
    ]);
    expect(calls.some((c) => c.includes("places.googleapis.com"))).toBe(true);
  });

  it("leaves existing photos alone and records failures as notes", async () => {
    const { fetch, calls } = fakeFetch({ search: "error", geo: "error" });
    const kept = await enrichPlace(place({ photos: [{ src: "https://x/y.jpg", alt: "y" }] }), { fetch });
    expect(kept.photos).toBeUndefined();
    expect(kept.enrichment.photos).toBe("existing");
    expect(calls.some((c) => c.includes("commons"))).toBe(false);

    const failed = await enrichPlace(place(), { fetch });
    expect(failed.enrichment.photos).toBe("none");
    expect(failed.enrichment.notes.join(" ")).toMatch(/Wikimedia Commons: commons 500/);
    expect(failed.enrichment.notes.join(" ")).toMatch(/GOOGLE_PLACES_SERVER_KEY/);
  });
});

describe("enrichPlace: TikTok", () => {
  it("searches, verifies captions, and keeps only videos about the place (with thumbnails and labels)", async () => {
    const { fetch } = fakeFetch({
      search: [],
      geo: [],
      brave: {
        web: {
          results: [
            { url: "https://www.tiktok.com/@bostonwithemily/video/7615719400229850399" },
            { url: "https://www.tiktok.com/@bostonwithemily/video/7615719400229850399?lang=en" }, // duplicate
            { url: "https://www.tiktok.com/discover/zaku-izakaya-boston" }, // not a video
            { url: "https://www.tiktok.com/@someone/video/7000000000000000001" },
          ],
        },
      },
      tiktok: {
        "7615719400229850399": tiktokHtml("7615719400229850399", "bostonwithemily", "Can't believe I walked past this hidden gem! Zaku Izakaya 📍South End"),
        "7000000000000000001": tiktokHtml("7000000000000000001", "someone", "Best ramen in Cambridge"),
      },
    });
    const deps: EnrichDeps = { fetch, braveKey: "BRAVE", resizeThumb: async (b) => ({ bytes: b, type: "image/jpeg" }) };
    const r = await enrichPlace(place({ social: { tiktok: ["https://www.tiktok.com/tag/zaku"] } }), deps);
    expect(r.enrichment.tiktok).toBe(1);
    expect(r.videos).toEqual([
      {
        videoId: "7615719400229850399",
        url: "https://www.tiktok.com/@bostonwithemily/video/7615719400229850399",
        label: "@bostonwithemily · Can't believe I walked past this hidden gem! Zaku…",
        thumb: new Uint8Array([1, 2, 3]),
        thumbType: "image/jpeg",
      },
    ]);
    // Existing (non-video) TikTok links are kept; the verified video is appended.
    expect(r.social?.tiktok).toEqual(["https://www.tiktok.com/tag/zaku", "https://www.tiktok.com/@bostonwithemily/video/7615719400229850399"]);
    expect(r.enrichment.notes).toContain("TikTok: 1 of 2 candidate videos were about this place");
  });

  it("skips places that already have a TikTok video, and explains when search is not configured", async () => {
    const { fetch, calls } = fakeFetch({ search: [], geo: [] });
    const has = await enrichPlace(place({ social: { tiktok: ["https://www.tiktok.com/@a/video/7320475537431055662"] } }), { fetch, braveKey: "B" });
    expect(has.enrichment.tiktok).toBe("existing");
    expect(calls.some((c) => c.includes("brave"))).toBe(false);

    const off = await enrichPlace(place(), { fetch });
    expect(off.enrichment.tiktok).toBe(0);
    expect(off.enrichment.notes.join(" ")).toMatch(/BRAVE_SEARCH_API_KEY/);
  });
});

describe("Wikimedia rate limits", () => {
  it("waits and retries on 429 before giving up", async () => {
    let calls = 0;
    const waits: number[] = [];
    const f = (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (!url.includes("commons")) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      calls++;
      if (calls <= 2) return { ok: false, status: 429, headers: new Headers({ "retry-after": "2" }), json: async () => ({}) } as unknown as Response;
      const isGeo = new URL(url).searchParams.get("generator") === "geosearch";
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ query: { pages: isGeo ? {} : { "1": commonsPage("Zaku Izakaya - Boston, MA") } } }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await enrichPlace(place(), { fetch: f, sleep: async (ms) => void waits.push(ms) });
    expect(r.enrichment.photos).toBe("commons");
    expect(waits).toEqual([2000, 2000]); // honoured Retry-After for both throttled requests
  });
});
