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
