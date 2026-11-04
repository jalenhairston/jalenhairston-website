# Things-to-do map — POC spec

One-off proof of concept for a week of personal use. To be redesigned and reimplemented for production later.

## Goal
A `/map` page: a global, zoomable map (Apple/Google Maps style) of things to do in cities. Each place links out to the TikToks / Instagram posts that show it. Success = a polished **mobile** experience.

## Decisions (from refinement Q&A)
| Topic | Decision |
|---|---|
| Map | MapLibre GL + OpenFreeMap tiles (free, no key). Worker served from `public/vendor/` (copied by `scripts/copy-map-worker.mjs` on dev/build). |
| Data | Static content: `content/places/*.md` (frontmatter: name, city, category, lat, lng, links[]; body = description). Validated in `lib/content.ts`. |
| Posts | TikTok (primary), Instagram. Link out in a new tab (`noopener noreferrer`); no embeds. |
| Interaction | Tap pin → bottom sheet on mobile, floating card on desktop. Esc / × closes. |
| Filtering | None. |
| Visitor adds | "+ Add place": search for the place by name (Photon, falling back to Nominatim; both free/keyless/OpenStreetMap) and pick a result to pre-fill name, city, category and exact spot, or tap the map to drop a pin. TikTok/Instagram link, photo and description are optional. Results already within 15m of a saved place (or the same name nearby) open that place instead of adding a duplicate. Saved in the visitor's `localStorage` only (no backend): it survives refreshes and restarts on that browser, but not other devices, cleared site data, or private browsing; a save failure now shows a warning. "Copy as content file" outputs markdown to promote it into `content/places/`. |
| Navigation | `Map` entry in the menu pill. |
| Styling | Reuses the existing design tokens; mobile-first, 44px+ touch targets. |
| Later | AI-assistant integration; real submissions/moderation; Neon storage; clustering. |

## Out of scope
Filters/search, embeds, server-side submissions, auth, clustering, offline.

## Known limits
- Seed places are `sample: true` placeholders linking to platform search pages, not real posts (keeps the site `noindex`).
- Overlapping pins at world zoom (e.g. 3 in Atlanta) until zoomed in.
- Visitor-added places are device-local.

## Social embeds & caching (TikTok / Instagram)

**What the card does.** The TikTok dropdown lists each saved video as a thumbnail row. Tapping a row swaps in the official TikTok embed (`/embed/v2/<id>`) in a sandboxed iframe. Saved Instagram reels/posts get the same row (`/reel/<code>/embed/captioned/`). Anything that is not a single video (search, profile, tag, place page) stays a plain link.

**Data flow.** `content/places/*.md` holds the links. `npm run social:refresh` reads every TikTok video link, loads the video page, downloads the cover image, resizes it (270x480 JPEG), and saves it to `public/social/tt-<id>-<hash>.jpg`; it records `video id -> thumb` in `content/social.json`. `lib/content.ts` merges that into each link at build time, so the page ships with everything it needs and the dropdown renders with no runtime requests.

**Why thumbnails are self-hosted.** TikTok cover URLs are signed and expire in ~48h, so they cannot be stored or hotlinked. (Caveat: these are thumbnails of third-party videos; fine for a private POC, revisit before a public launch.)

**Background warm-up.** When a place is broken out of its cluster, its thumbnails are fetched at idle priority (`requestIdleCallback`), nearest to the map centre first, capped at 30 places and 4 thumbs per place per session, and skipped on Save-Data / 2G. Opening a card warms that place immediately and preconnects to the embed host on first dropdown open / play.

**What is deliberately not pre-loaded: the embeds.** TikTok and Instagram serve embed pages `cache-control: no-store` and each is ~1MB of third-party JS, so pre-loading them would cost bandwidth and memory and could not be reused. They load on tap only.

**Cache policy.**
| Asset | Policy |
|---|---|
| `/social/*.jpg` | `public, max-age=31536000, immutable` (next.config.ts). Content-hashed names; a changed cover gets a new filename. |
| Page + content (incl. caption text) | Static, rebuilt per deploy. |
| Embeds | Never cached by us; loaded on demand. |
| Freshness | Re-run `npm run social:refresh -- --force` periodically (or on a schedule) to pick up new covers; videos that were deleted are reported as "unavailable". |

**Instagram status.** Embed support is implemented but unverified: Instagram does not index individual reels (searches only return profile pages) and its profile embed sends `X-Frame-Options: DENY`, so no reel links are populated. Paste a real reel URL into a place's `links:` (`platform: instagram`) to use it; if it does not embed, the row's ↗ button still opens it on Instagram.

## Map is strictly flat

The basemap (OpenFreeMap "liberty") draws 3D buildings from zoom 14, and MapLibre lets two fingers tilt and rotate. Tilted, a pin is anchored to the ground while building tops lean further at every zoom level, so pins appear to slide across buildings, and a tap on a rooftop lands on a different ground spot. There is also no compass to get back to north-up. So the map is locked flat: `maxPitch: 0`, rotation disabled (pinch still zooms), and the `building-3d` layer is flattened (`fill-extrusion-height/base` = 0). `/map?debug-map` exposes the map as `window.__map` for tests.

## Place search quality

Measured on 31 Boston places with known coordinates (hit = a result within 300m):

| Strategy | Found |
|---|---|
| Photon, unbounded (old) | 22/31 (70%) |
| Photon limited to the map's region (bbox) | 24/31 (77%) |
| Region + "query + city" variant, merged (current) | 26/31 (83%) |
| + Nominatim merged on top | 26/31 (no gain) |

The 5 misses (Broken Cup, BU Campus Store, Lola 42, Tony & Elaine's, Zaku Izakaya) are places OpenStreetMap lacks or lists under another name; free OSM-based search will not find them. Real searches are likely worse than 70% because this test set came largely from OSM.

**Optional: Google Places (recommended for real coverage).** Set `NEXT_PUBLIC_GOOGLE_PLACES_KEY` (Vercel -> Project -> Settings -> Environment Variables, then redeploy). Create the key in Google Cloud: enable "Places API (New)", create an API key, restrict it to HTTP referrers (`*.vercel.app/*` plus your domain) and to the Places API, and set a daily quota/budget alert. When present it is tried first (Text Search with a 50km location bias); if it fails or finds nothing, search falls back to OpenStreetMap. The Google integration is written to the documented API shape and unit-tested with a fixture, but has not been exercised against the live API.

## Places database (Neon Postgres)

Places live in a `"Place"` table (`db/migrations/0001_create_place.sql`):

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | uuid for new places; seeded places keep their old slug |
| `name` | text | required, ≤120 chars |
| `address` | text, nullable | filled in from search results |
| `description` | text | ≤1000 chars |
| `social` | jsonb object | platform → array of links, e.g. `{"tiktok": ["https://www.tiktok.com/@u/video/1"], "instagram": ["…", "…"]}`. A platform with several links is shown as a dropdown. |
| `latitude`, `longitude` | double precision | needed to put the pin on the map |
| `city`, `category`, `photos` (jsonb array) | | used by the card and pins |
| `created_at`, `updated_at` | timestamptz | |

**Reads.** `/map` must stay fully static (root layout `ensureStatic = "navigation"`), so `lib/places-data.ts` reads the table inside `'use cache'` with `cacheTag("places")`, prerendered at build. **Writes** are server actions (`app/map/actions.ts`) that call `updateTag("places")`, so the next page load re-renders with fresh data.

**Edit code.** Server actions are public POST endpoints, so every write checks `PLACES_EDIT_CODE` (constant-time compare). The UI asks for it once per device and remembers it in local storage; a wrong code is forgotten. Without `PLACES_EDIT_CODE` set, writes are refused.

**Migrations + seed.** `npm run db:migrate` applies `db/migrations/*.sql` once each (tracked in `_migrations`) and seeds the real (non-sample) places from `content/places` exactly once ever, so deleting places is never undone by a later deploy. Vercel runs it automatically via the `vercel-build` script before `next build`. It skips when there is no database URL.

**Without a database** (local dev, e2e tests) an in-memory store seeded from `content/places` is used; changes vanish on restart and the add form says "Demo mode".

**Legacy device-only places** (saved in local storage before this) show a "Move to shared map" banner that uploads them with the edit code.

**Vercel environment variables**
- `DATABASE_URL`: set by the Neon integration (per preview branch when branching is on). `POSTGRES_URL` is accepted as a fallback.
- `PLACES_EDIT_CODE`: choose a passphrase; share it only with people who should edit. Server-only (no `NEXT_PUBLIC_` prefix).

**Tests.** `lib/places-store.test.ts` runs the real migration and queries against PGlite (Postgres in WASM): CRUD, JSONB round-trips, table constraints, seed-once. e2e runs against the in-memory store with `PLACES_EDIT_CODE=e2e-edit-code` (see `playwright.config.ts`).

## Enrichment pipeline (photos + TikToks)

After every new place (and every place moved from a device), `createPlace`/`importPlaces` schedule `runEnrichment` with Next's `after()`, so saving is not slowed down. It only fills what is missing:

1. **Photos** (if the place has none): Wikimedia Commons, searching by name and by location (within 150m). Businesses only accept files whose title names the place; landmarks (outdoors/culture) may also use photos taken within 80m. 429s are retried with backoff (`Retry-After`). If Commons has nothing: **Google Places photos** (needs `GOOGLE_PLACES_SERVER_KEY`). Google does not allow storing photo files or URLs, so only the Google place id is stored and `/place-photo/<placeId>/<n>` asks Google for a fresh photo URL on each view (redirect, cached 1h). Google photos show the photographer credit, as Google requires.
2. **TikToks** (if the place has no playable TikTok): a web search via the **Brave Search API** (`BRAVE_SEARCH_API_KEY`) for `site:tiktok.com` video links; each candidate page is loaded and kept only if its caption names the place (up to 3). The cover is resized and stored in the `SocialVideo` table (TikTok's cover URLs expire in ~48h) and served from `/social-thumb/<videoId>`.

Results and notes (e.g. "TikTok search is off (BRAVE_SEARCH_API_KEY is not set)") are stored on the place (`enrichment`, `enriched_at`), then the cached list is expired (`revalidateTag("places", { expire: 0 })`). The card shows "Looking for photos and TikToks…" and checks back (`getPlaceStatus`) until the run finishes. Places still missing something show **Find photos & TikToks** (edit code required; runs immediately).

**Backfill existing places:** `DATABASE_URL=… BRAVE_SEARCH_API_KEY=… GOOGLE_PLACES_SERVER_KEY=… PLACES_EDIT_CODE=… npm run places:enrich -- --site https://<your-site>` (add `--all` to retry places that were already tried). `--site` calls `POST /api/places/revalidate` (edit code in `x-edit-code`) so the live list refreshes.

**Keys (Vercel env, server-only, no `NEXT_PUBLIC_`):**
- `BRAVE_SEARCH_API_KEY`: https://api.search.brave.com (check current free allowance).
- `GOOGLE_PLACES_SERVER_KEY`: a second Google key, API restriction "Places API (New)", **no** website restriction (server calls send no referrer). Keep the daily quota cap.

**Tests:** `lib/enrich.test.ts` covers each source with fixtures (relevance rules, Google fallback, TikTok caption checks, 429 retries, notes when keys are missing). e2e runs with `PLACES_ENRICH_FAKE=1`, a deterministic stand-in (no network), to cover the background run, polling, persistence, thumbnails and the Find button. Checked live from the sandbox: TikTok verification + thumbnails on real pages, and a real Commons match (Zaku Izakaya); Brave and Google calls are untested against the live services (no keys here).
