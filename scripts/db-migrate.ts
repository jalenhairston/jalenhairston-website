// Create/upgrade the "Place" table and seed it once. Runs before `next build` on Vercel (see "vercel-build"
// in package.json). Skips quietly when no database is configured.
//   npm run db:migrate
import { neon } from "@neondatabase/serverless";
import { migrate } from "../lib/places-migrate";
import { seedPlaces } from "../lib/places-seed";

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    console.log("db:migrate: no DATABASE_URL, skipping (the map will use its in-memory fallback)");
    return;
  }
  const sql = neon(url);
  const result = await migrate((text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>, seedPlaces);
  console.log(`db:migrate: applied ${result.applied.length ? result.applied.join(", ") : "nothing new"}; seeded ${result.seeded} places`);
}

main().catch((e) => {
  console.error("db:migrate failed:", e);
  process.exit(1);
});
