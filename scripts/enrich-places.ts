// Backfill: run the enrichment pipeline over places in the database that are missing photos or a TikTok.
//   npm run places:enrich                          places never enriched before
//   npm run places:enrich -- --all                 every incomplete place, even if tried before
//   npm run places:enrich -- --site https://…      afterwards, refresh the live site's cached list
//   npm run places:enrich -- --soft --budget 240   deploy mode (see "vercel-build"): never fails, and stops
//                                                  starting new places after ~240s; the rest are picked up
//                                                  on the next deploy
// Needs DATABASE_URL; uses BRAVE_SEARCH_API_KEY / GOOGLE_PLACES_SERVER_KEY when set, and PLACES_EDIT_CODE for --site.
import { neon } from "@neondatabase/serverless";
import sharp from "sharp";
import { enrichPlace } from "../lib/enrich";
import { pgStore } from "../lib/places-store";
import { embedFor } from "../lib/social";

const soft = process.argv.includes("--soft");

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    if (soft) return console.log("places:enrich: no DATABASE_URL, skipping");
    throw new Error("DATABASE_URL is not set");
  }
  const all = process.argv.includes("--all");
  const budgetArg = process.argv.indexOf("--budget");
  const budgetMs = budgetArg > 0 ? Number(process.argv[budgetArg + 1]) * 1000 : Infinity;
  const started = Date.now();
  const siteArg = process.argv.indexOf("--site");
  const site = siteArg > 0 ? process.argv[siteArg + 1] : undefined;
  const sql = neon(url);
  const store = pgStore((text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>);
  const deps = {
    fetch,
    braveKey: process.env.BRAVE_SEARCH_API_KEY || undefined,
    googleKey: process.env.GOOGLE_PLACES_SERVER_KEY || undefined,
    resizeThumb: async (bytes: Uint8Array) => ({
      bytes: new Uint8Array(await sharp(bytes).resize(270, 480, { fit: "cover", position: "attention" }).jpeg({ quality: 72, mozjpeg: true }).toBuffer()),
      type: "image/jpeg",
    }),
  };
  const places = (await store.list()).filter((p) => {
    const incomplete = p.photos.length === 0 || !(p.social.tiktok ?? []).some((u) => embedFor({ platform: "tiktok", url: u }));
    return incomplete && (all || !p.enrichedAt);
  });
  console.log(`places:enrich: ${places.length} place(s) to look up`);
  let done = 0;
  for (const p of places) {
    if (Date.now() - started > budgetMs) {
      console.log(`places:enrich: time budget used; ${places.length - done} place(s) left for next time`);
      break;
    }
    done++;
    const res = await enrichPlace(p, deps);
    for (const v of res.videos) await store.upsertVideo(v);
    await store.update(p.id, { photos: res.photos, social: res.social, googlePlaceId: res.googlePlaceId, enrichment: res.enrichment, enrichedAt: res.enrichment.ranAt });
    console.log(`  ${p.name}: photos=${res.enrichment.photos} tiktok=${res.enrichment.tiktok}${res.enrichment.notes.length ? ` (${res.enrichment.notes.join("; ")})` : ""}`);
  }
  if (site) {
    const res = await fetch(new URL("/api/places/revalidate", site), { method: "POST", headers: { "x-edit-code": process.env.PLACES_EDIT_CODE ?? "" } });
    console.log(`refresh ${site}: ${res.status}`);
  }
}

main().catch((e) => {
  console.error("places:enrich failed:", e);
  // In deploy mode a lookup problem must never block the site from building.
  process.exit(soft ? 0 : 1);
});
