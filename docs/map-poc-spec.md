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
| Visitor adds | "+ Add place": tap map, fill form. Saved in the visitor's `localStorage` only (no backend). "Copy as content file" outputs markdown to promote it into `content/places/`. |
| Navigation | `Map` entry in the menu pill. |
| Styling | Reuses the existing design tokens; mobile-first, 44px+ touch targets. |
| Later | AI-assistant integration; real submissions/moderation; Neon storage; clustering. |

## Out of scope
Filters/search, embeds, server-side submissions, auth, clustering, offline.

## Known limits
- Seed places are `sample: true` placeholders linking to platform search pages, not real posts (keeps the site `noindex`).
- Overlapping pins at world zoom (e.g. 3 in Atlanta) until zoomed in.
- Visitor-added places are device-local.
