// The Place model shared by the database layer, server actions and the map UI.
// Framework-free (no Next/React imports) so it can be unit-tested and used from scripts.
import { z } from "zod";
import { parseTikTok } from "./social";

export const CATEGORIES = ["food", "drinks", "coffee", "outdoors", "culture", "nightlife", "shopping", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Photo = { src: string; alt: string; credit?: string; creditUrl?: string };
/** Platform name -> links, e.g. { tiktok: ["https://www.tiktok.com/@u/video/1"] }. */
export type Social = Record<string, string[]>;

/** One row of the "Place" table as plain, serializable JSON. */
export type PlaceRecord = {
  id: string;
  name: string;
  address: string | null;
  description: string;
  social: Social;
  latitude: number;
  longitude: number;
  city: string;
  category: string;
  photos: Photo[];
  /** Google Places id, when the enrichment pipeline matched one (photos are fetched through it). */
  googlePlaceId: string | null;
  /** When the enrichment pipeline last ran for this place (null = never). */
  enrichedAt: string | null;
  /** What the pipeline found or why it could not, e.g. { photos: "commons", tiktok: 2, notes: [...] }. */
  enrichment: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

/** A TikTok video the pipeline (or the refresh script) looked at. */
export type SocialVideo = { videoId: string; url: string; label: string | null; thumb?: Uint8Array | null; thumbType?: string | null };

const httpsUrl = z.url().max(2048).refine((u) => u.startsWith("https://"), "links must start with https://");

export const placeInputSchema = z.object({
  /** Optional caller-chosen id (used for seeding); otherwise one is generated. */
  id: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
  name: z.string().trim().min(1, "name is required").max(120),
  address: z.string().trim().max(300).nullish().transform((v) => (v ? v : null)),
  description: z.string().trim().max(1000).default(""),
  social: z.record(z.string().regex(/^[a-z0-9_-]{1,30}$/), z.array(httpsUrl).max(20)).default({}),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  city: z.string().trim().max(100).default(""),
  category: z.enum(CATEGORIES).default("other"),
  photos: z
    .array(
      z.object({
        src: z.string().max(2048).refine((s) => s.startsWith("https://") || s.startsWith("/"), "photo must be https:// or a site path"),
        alt: z.string().max(200),
        credit: z.string().max(200).optional(),
        creditUrl: httpsUrl.optional(),
      }),
    )
    .max(10)
    .default([]),
});
export type PlaceInput = z.input<typeof placeInputSchema>;
export type ValidPlaceInput = z.output<typeof placeInputSchema>;

/** Which platform a link belongs to (used as the key in `social`). */
export function platformFor(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  } catch {}
  return "web";
}

/** Group a flat list of links into the `social` shape, dropping duplicates and empty platforms. */
export function socialFromLinks(urls: string[]): Social {
  const out: Social = {};
  for (const raw of urls) {
    const url = raw.trim();
    if (!url) continue;
    const key = platformFor(url);
    out[key] ??= [];
    if (!out[key].includes(url)) out[key].push(url);
  }
  return out;
}

/** The map UI's view of a place. */
export type MapLink = { platform: string; url: string; title?: string; thumb?: string };
export type MapPlace = {
  id: string;
  name: string;
  address?: string;
  city: string;
  category: string;
  lat: number;
  lng: number;
  description: string;
  photos: Photo[];
  links: MapLink[];
  /** Legacy: saved only in this browser before places moved to the database. */
  userAdded: boolean;
  /** When the enrichment pipeline last ran (null/undefined = not yet). */
  enrichedAt?: string | null;
  /** The pipeline's notes from its last run (what it found, or why it could not). */
  enrichNotes?: string[];
};

export type SocialManifest = { items?: Record<string, { thumb?: string; label?: string }> };

/** Database record -> map place, decorating TikTok links with cached thumbnails and captions. */
export function toMapPlace(r: PlaceRecord, manifest: SocialManifest = {}): MapPlace {
  const links: MapLink[] = [];
  for (const [platform, urls] of Object.entries(r.social)) {
    for (const url of urls) {
      const tt = platform === "tiktok" ? parseTikTok(url) : null;
      const item = tt ? manifest.items?.[tt.id] : undefined;
      links.push({
        platform,
        url,
        ...(item?.label ? { title: item.label } : tt ? { title: `TikTok by @${tt.user}` } : {}),
        ...(item?.thumb ? { thumb: item.thumb } : {}),
      });
    }
  }
  return {
    id: r.id,
    name: r.name,
    ...(r.address ? { address: r.address } : {}),
    city: r.city,
    category: r.category,
    lat: r.latitude,
    lng: r.longitude,
    description: r.description,
    photos: r.photos,
    links,
    userAdded: false,
    enrichedAt: r.enrichedAt,
    ...(Array.isArray(r.enrichment.notes) ? { enrichNotes: (r.enrichment.notes as unknown[]).map(String) } : {}),
  };
}
