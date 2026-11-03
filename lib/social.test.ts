import { describe, expect, it } from "vitest";
import { canWarm, embedFor, parseInstagram, parseTikTok } from "./social";

describe("parseTikTok", () => {
  it("reads user and id from a video URL, with or without www, query string or trailing slash", () => {
    expect(parseTikTok("https://www.tiktok.com/@lord_cappuccino/video/7320475537431055662")).toEqual({ user: "lord_cappuccino", id: "7320475537431055662" });
    expect(parseTikTok("https://tiktok.com/@a.b/video/7320475537431055662/?lang=en")).toEqual({ user: "a.b", id: "7320475537431055662" });
  });
  it("rejects profiles, tags, place pages, search, short ids and other hosts", () => {
    for (const url of [
      "https://www.tiktok.com/@covetboston",
      "https://www.tiktok.com/tag/fenwaypark",
      "https://www.tiktok.com/place/Quincy-Market-20442395496712727",
      "https://www.tiktok.com/search?q=neptune",
      "https://www.tiktok.com/@a/video/123",
      "https://evil.example/@a/video/7320475537431055662",
      "not a url",
    ])
      expect(parseTikTok(url), url).toBeNull();
  });
});

describe("parseInstagram", () => {
  it("reads reels and posts, including the /username/reel/ form", () => {
    expect(parseInstagram("https://www.instagram.com/reel/C0abcDEFghi/")).toEqual({ kind: "reel", code: "C0abcDEFghi" });
    expect(parseInstagram("https://www.instagram.com/p/DAbcdefGH12")).toEqual({ kind: "p", code: "DAbcdefGH12" });
    expect(parseInstagram("https://www.instagram.com/neptuneoyster/reel/C0abcDEFghi/")).toEqual({ kind: "reel", code: "C0abcDEFghi" });
  });
  it("rejects profiles and hashtag pages", () => {
    expect(parseInstagram("https://www.instagram.com/neptuneoyster/")).toBeNull();
    expect(parseInstagram("https://www.instagram.com/explore/tags/neptuneoyster/")).toBeNull();
  });
});

describe("embedFor", () => {
  it("builds the official iframe URL for a TikTok video", () => {
    expect(embedFor({ platform: "tiktok", url: "https://www.tiktok.com/@u/video/7320475537431055662" })).toMatchObject({
      src: "https://www.tiktok.com/embed/v2/7320475537431055662",
      openUrl: "https://www.tiktok.com/@u/video/7320475537431055662",
    });
  });
  it("builds the captioned embed URL for an Instagram reel", () => {
    expect(embedFor({ platform: "instagram", url: "https://www.instagram.com/reel/C0abcDEFghi/" })?.src).toBe(
      "https://www.instagram.com/reel/C0abcDEFghi/embed/captioned/",
    );
  });
  it("returns null for anything that is not a single video", () => {
    expect(embedFor({ platform: "tiktok", url: "https://www.tiktok.com/@covetboston" })).toBeNull();
    expect(embedFor({ platform: "google", url: "https://www.google.com/search?q=x" })).toBeNull();
  });
});

describe("canWarm", () => {
  it("allows warm-up by default and on good connections", () => {
    expect(canWarm(undefined)).toBe(true);
    expect(canWarm({ effectiveType: "4g" })).toBe(true);
  });
  it("skips it on Save-Data and 2G", () => {
    expect(canWarm({ saveData: true, effectiveType: "4g" })).toBe(false);
    expect(canWarm({ effectiveType: "2g" })).toBe(false);
    expect(canWarm({ effectiveType: "slow-2g" })).toBe(false);
  });
});
