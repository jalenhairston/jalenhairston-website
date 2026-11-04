import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeInputSchema, type ValidPlaceInput } from "./places-model";
import { migrate, splitStatements } from "./places-migrate";
import { memoryStore, pgStore, type Query } from "./places-store";

const input = (over: Partial<Parameters<typeof placeInputSchema.parse>[0]> = {}): ValidPlaceInput =>
  placeInputSchema.parse({
    name: "Neptune Oyster",
    address: "63 Salem St, Boston, MA",
    description: "Get the lobster roll.",
    social: { tiktok: ["https://www.tiktok.com/@a/video/7320475537431055662"], instagram: [] },
    latitude: 42.3632,
    longitude: -71.056,
    city: "Boston",
    category: "food",
    photos: [{ src: "https://example.com/a.jpg", alt: "front" }],
    ...over,
  });

// Starting PGlite (Postgres in WASM) and running migrations takes a few seconds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let db: PGlite;
let query: Query;
beforeEach(async () => {
  db = new PGlite();
  query = async (text, params) => (await db.query(text, params as unknown[])).rows as Record<string, unknown>[];
});

describe("migrate", () => {
  it("creates the Place table, seeds once, and never re-seeds", async () => {
    const seeds = [input({ id: "neptune-oyster" }), input({ id: "mikes-pastry", name: "Mike's Pastry" })];
    const first = await migrate(query, () => seeds);
    expect(first).toEqual({ applied: ["0001_create_place.sql", "0002_enrichment.sql"], seeded: 2 });
    const store = pgStore(query);
    expect((await store.list()).map((p) => p.id)).toEqual(["neptune-oyster", "mikes-pastry"]);

    // Deleting everything and redeploying must not bring the seed places back.
    await store.remove("neptune-oyster");
    await store.remove("mikes-pastry");
    expect(await migrate(query, () => seeds)).toEqual({ applied: [], seeded: 0 });
    expect(await store.count()).toBe(0);
  });
  it("splits statements and ignores comments", () => {
    expect(splitStatements("-- hi\nCREATE TABLE a (x int);\n\nCREATE INDEX i ON a (x);\n")).toEqual(["CREATE TABLE a (x int)", "CREATE INDEX i ON a (x)"]);
  });
});

describe("pgStore", () => {
  beforeEach(async () => {
    await migrate(query, () => []);
  });
  it("round-trips every field, including the social JSON", async () => {
    const store = pgStore(query);
    const created = await store.create(input({ social: { tiktok: ["https://www.tiktok.com/@a/video/7320475537431055662"], instagram: ["https://www.instagram.com/reel/C0abcDEFghi/", "https://www.instagram.com/p/DAbcdefGH12/"] } }));
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/); // generated
    expect(created).toMatchObject({
      name: "Neptune Oyster",
      address: "63 Salem St, Boston, MA",
      latitude: 42.3632,
      longitude: -71.056,
      social: { instagram: ["https://www.instagram.com/reel/C0abcDEFghi/", "https://www.instagram.com/p/DAbcdefGH12/"] },
      photos: [{ src: "https://example.com/a.jpg", alt: "front" }],
    });
    expect(Date.parse(created.createdAt)).not.toBeNaN();
    const [listed] = await store.list();
    expect(listed).toEqual(created);
    expect(await store.remove(created.id)).toBe(true);
    expect(await store.remove(created.id)).toBe(false);
  });
  it("is protected by table constraints even if validation is bypassed", async () => {
    const store = pgStore(query);
    await expect(store.create({ ...input(), latitude: 120 })).rejects.toThrow();
    await expect(store.create({ ...input(), name: "" })).rejects.toThrow();
    await expect(store.create({ ...input(), id: "dup" }).then(() => store.create({ ...input(), id: "dup" }))).rejects.toThrow();
  });
});

describe("memoryStore", () => {
  it("lists seeds, creates, and removes", async () => {
    const store = memoryStore([input({ id: "seed" })]);
    expect(store.kind).toBe("memory");
    const p = await store.create(input({ name: "New" }));
    expect((await store.list()).map((x) => x.name)).toEqual(["Neptune Oyster", "New"]);
    expect(await store.remove(p.id)).toBe(true);
    expect(await store.count()).toBe(1);
  });
});

describe("enrichment storage", () => {
  const stores = {
    postgres: async () => {
      await migrate(query, () => []);
      return pgStore(query);
    },
    memory: async () => memoryStore([]),
  };
  for (const [name, make] of Object.entries(stores)) {
    it(`${name}: updates only the patched fields and caches video labels + thumbnails`, async () => {
      const store = await make();
      const p = await store.create(input());
      expect(p).toMatchObject({ googlePlaceId: null, enrichedAt: null, enrichment: {} });
      const photos = [{ src: "/place-photo/ChIJ1/0", alt: "Neptune Oyster", credit: "Google Maps · A. Person" }];
      const updated = await store.update(p.id, { photos, googlePlaceId: "ChIJ1", enrichment: { photos: "google", tiktok: 0 }, enrichedAt: "2026-11-04T12:00:00.000Z" });
      expect(updated).toMatchObject({ photos, googlePlaceId: "ChIJ1", enrichment: { photos: "google", tiktok: 0 }, name: "Neptune Oyster", address: "63 Salem St, Boston, MA" });
      expect(Date.parse(updated!.enrichedAt!)).toBe(Date.parse("2026-11-04T12:00:00.000Z"));
      expect((await store.get(p.id))?.photos).toEqual(photos);
      expect(await store.update("missing", { photos })).toBeNull();

      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x10, 0x4a]);
      await store.upsertVideo({ videoId: "7320475537431055662", url: "https://www.tiktok.com/@a/video/7320475537431055662", label: "@a · lobster roll", thumb: bytes, thumbType: "image/jpeg" });
      // A later upsert without a thumbnail keeps the stored one.
      await store.upsertVideo({ videoId: "7320475537431055662", url: "https://www.tiktok.com/@a/video/7320475537431055662", label: null });
      expect(await store.listVideos()).toEqual([{ videoId: "7320475537431055662", label: "@a · lobster roll", hasThumb: true }]);
      const thumb = await store.getVideoThumb("7320475537431055662");
      expect(Array.from(thumb!.bytes)).toEqual(Array.from(bytes));
      expect(thumb!.type).toBe("image/jpeg");
      expect(await store.getVideoThumb("nope")).toBeNull();
    });
  }
});
