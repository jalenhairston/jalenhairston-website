import { describe, expect, it } from "vitest";
import { placeInputSchema, platformFor, socialFromLinks, toMapPlace, type PlaceRecord } from "./places-model";

describe("platformFor / socialFromLinks", () => {
  it("groups links by platform and drops blanks and duplicates", () => {
    expect(
      socialFromLinks([
        "https://www.tiktok.com/@a/video/7320475537431055662",
        " ",
        "https://www.instagram.com/reel/C0abcDEFghi/",
        "https://www.tiktok.com/@a/video/7320475537431055662",
        "https://youtu.be/abc",
        "https://example.com/menu",
      ]),
    ).toEqual({
      tiktok: ["https://www.tiktok.com/@a/video/7320475537431055662"],
      instagram: ["https://www.instagram.com/reel/C0abcDEFghi/"],
      youtube: ["https://youtu.be/abc"],
      web: ["https://example.com/menu"],
    });
    expect(platformFor("not a url")).toBe("web");
  });
});

describe("placeInputSchema", () => {
  const base = { name: "X", latitude: 1, longitude: 2 };
  it("fills defaults and normalises an empty address to null", () => {
    expect(placeInputSchema.parse({ ...base, address: "" })).toMatchObject({ address: null, description: "", social: {}, city: "", category: "other", photos: [] });
  });
  it("rejects bad coordinates, non-https links, unknown categories and bad platform keys", () => {
    expect(() => placeInputSchema.parse({ ...base, latitude: 91 })).toThrow();
    expect(() => placeInputSchema.parse({ ...base, social: { tiktok: ["http://tiktok.com/x"] } })).toThrow();
    expect(() => placeInputSchema.parse({ ...base, category: "spa" })).toThrow();
    expect(() => placeInputSchema.parse({ ...base, social: { "Bad Key!": [] } })).toThrow();
    expect(() => placeInputSchema.parse({ ...base, name: "  " })).toThrow();
  });
});

describe("toMapPlace", () => {
  const rec: PlaceRecord = {
    id: "p1",
    name: "Neptune Oyster",
    address: null,
    description: "",
    social: { tiktok: ["https://www.tiktok.com/@lord_cappuccino/video/7320475537431055662", "https://www.tiktok.com/@new/video/7000000000000000001"], instagram: ["https://www.instagram.com/neptuneoyster/"] },
    latitude: 42.36,
    longitude: -71.05,
    city: "Boston",
    category: "food",
    photos: [],
    createdAt: "2026-11-04T00:00:00.000Z",
    updatedAt: "2026-11-04T00:00:00.000Z",
  };
  it("flattens social into links, adding cached thumbnails and captions for known TikToks", () => {
    const m = toMapPlace(rec, { items: { "7320475537431055662": { thumb: "/social/tt-x.jpg", label: "@lord_cappuccino · My favorite lobster roll" } } });
    expect(m).toMatchObject({ id: "p1", lat: 42.36, lng: -71.05, userAdded: false });
    expect(m.address).toBeUndefined();
    expect(m.links).toEqual([
      { platform: "tiktok", url: rec.social.tiktok[0], title: "@lord_cappuccino · My favorite lobster roll", thumb: "/social/tt-x.jpg" },
      { platform: "tiktok", url: rec.social.tiktok[1], title: "TikTok by @new" },
      { platform: "instagram", url: rec.social.instagram[0] },
    ]);
  });
});
