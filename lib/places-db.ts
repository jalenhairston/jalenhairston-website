// Server-only: picks the place store. With DATABASE_URL (set by the Neon <-> Vercel integration) places live
// in Postgres; without it, an in-memory store seeded from content/places is used (local dev and e2e tests;
// changes vanish on restart).
import "server-only";
import { neon } from "@neondatabase/serverless";
import { memoryStore, pgStore, type PlaceStore } from "./places-store";
import { seedPlaces } from "./places-seed";

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

const g = globalThis as unknown as { __placeStore?: PlaceStore };

export function getStore(): PlaceStore {
  if (g.__placeStore) return g.__placeStore;
  const url = databaseUrl();
  if (url) {
    const sql = neon(url);
    g.__placeStore = pgStore((text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>);
  } else {
    g.__placeStore = memoryStore(seedPlaces());
  }
  return g.__placeStore;
}
