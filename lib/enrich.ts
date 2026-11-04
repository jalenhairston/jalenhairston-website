// The enrichment pipeline: fill in missing photos and TikTok videos for a place.
//   Photos: Wikimedia Commons (free, licensed) first, then Google Places photos (needs a server key).
//   TikToks: a web search (Brave Search API key) for tiktok.com video links, each verified by loading the
//            video page and checking its caption is about this place.
// Framework-free: every network call goes through deps.fetch, so it is unit-tested with fixtures.
import type { Photo, PlaceRecord, Social, SocialVideo } from "./places-model";
import { embedFor, parseTikTok, parseTikTokPage, tiktokLabel } from "./social";
import { distanceMeters } from "./geocode";

export type EnrichDeps = {
  fetch: typeof fetch;
  /** Brave Search API key: enables TikTok discovery. */
  braveKey?: string;
  /** Google Places API key usable from a server (no website restriction): enables Google photos. */
  googleKey?: string;
  /** Shrink a TikTok cover before storing it (sharp on the server); identity by default. */
  resizeThumb?: (bytes: Uint8Array) => Promise<{ bytes: Uint8Array; type: string }>;
  now?: () => Date;
  /** Wait between retries (overridable in tests). */
  sleep?: (ms: number) => Promise<void>;
};

export type EnrichResult = {
  /** Only set when the place had no photos and some were found. */
  photos?: Photo[];
  /** Only set when TikToks were added. */
  social?: Social;
  googlePlaceId?: string;
  videos: SocialVideo[];
  enrichment: { photos: "existing" | "commons" | "google" | "none"; tiktok: "existing" | number; notes: string[]; ranAt: string };
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const BOT_UA = "jalenhairston-website/0.1 (https://github.com/jalenhairston/jalenhairston-website)";
const MAX_PHOTOS = 3;
const MAX_TIKTOKS = 3;
const MAX_TIKTOK_CANDIDATES = 8;

const GENERIC = new Set(
  "the and of a an at in on by co inc llc cafe café coffee bar pub restaurant store shop boutique house kitchen street st market boston new".split(" "),
);
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Distinctive words of a place name ("Zaku Izakaya" -> zaku, izakaya; "Acorn Street" -> acorn). */
export function nameTokens(name: string, city = ""): string[] {
  const skip = new Set([...GENERIC, ...norm(city).split(/[^a-z0-9]+/)]);
  return [...new Set(norm(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !skip.has(t)))];
}

/** Does this text (a caption, a file title) talk about the place? */
export function mentionsPlace(text: string, name: string, city = ""): boolean {
  const hay = norm(text).replace(/[^a-z0-9]+/g, " ");
  const squashed = hay.replace(/ /g, "");
  const tokens = nameTokens(name, city);
  if (tokens.length === 0) return squashed.includes(norm(name).replace(/[^a-z0-9]/g, ""));
  const hits = tokens.filter((t) => squashed.includes(t)).length;
  return hits >= Math.max(1, Math.ceil(tokens.length / 2));
}

// --- Photos -----------------------------------------------------------------------------------------

type CommonsPage = {
  title: string;
  index?: number;
  coordinates?: { lat: number; lon: number }[];
  imageinfo?: { thumburl?: string; descriptionurl?: string; mime?: string; extmetadata?: { LicenseShortName?: { value?: string } } }[];
};

async function commonsQuery(deps: EnrichDeps, params: Record<string, string>): Promise<CommonsPage[]> {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", prop: "imageinfo|coordinates", iiprop: "url|mime|extmetadata", iiurlwidth: "960", ...params })) u.searchParams.set(k, v);
  // Wikimedia rate-limits anonymous API use (429); wait as asked (capped) and retry twice.
  let res = await deps.fetch(u, { headers: { "user-agent": BOT_UA } });
  for (let attempt = 1; res.status === 429 && attempt <= 2; attempt++) {
    const retryAfter = Number(res.headers?.get?.("retry-after"));
    const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt, 5000);
    await (deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(waitMs);
    res = await deps.fetch(u, { headers: { "user-agent": BOT_UA } });
  }
  if (!res.ok) throw new Error(`commons ${res.status}`);
  const pages = ((await res.json()) as { query?: { pages?: Record<string, CommonsPage> } }).query?.pages ?? {};
  return Object.values(pages).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

export async function commonsPhotos(rec: PlaceRecord, deps: EnrichDeps): Promise<Photo[]> {
  const [byName, nearby] = await Promise.all([
    commonsQuery(deps, { generator: "search", gsrsearch: `${rec.name} ${rec.city}`, gsrnamespace: "6", gsrlimit: "15" }),
    commonsQuery(deps, { generator: "geosearch", ggscoord: `${rec.latitude}|${rec.longitude}`, ggsradius: "150", ggsnamespace: "6", ggslimit: "20" }),
  ]);
  // Landmarks (parks, museums, streets) can use nearby photos; businesses need the name in the file title.
  const landmark = rec.category === "outdoors" || rec.category === "culture";
  const out: Photo[] = [];
  const seen = new Set<string>();
  for (const page of [...byName, ...nearby]) {
    if (out.length >= MAX_PHOTOS || seen.has(page.title)) continue;
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !/^image\/(jpeg|png|webp)$/.test(info.mime ?? "")) continue;
    const title = page.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "");
    const c = page.coordinates?.[0];
    const near = c ? distanceMeters({ lat: c.lat, lng: c.lon }, { lat: rec.latitude, lng: rec.longitude }) <= 80 : false;
    if (!mentionsPlace(title, rec.name, rec.city) && !(landmark && near)) continue;
    seen.add(page.title);
    const license = info.extmetadata?.LicenseShortName?.value;
    out.push({
      src: info.thumburl.split("?")[0],
      alt: rec.name,
      credit: `${license ? `${license} ` : ""}via Wikimedia Commons`.trim(),
      ...(info.descriptionurl ? { creditUrl: info.descriptionurl } : {}),
    });
  }
  return out;
}

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  photos?: { name?: string; authorAttributions?: { displayName?: string; uri?: string }[] }[];
};

/** Match the place on Google (same name, within ~200m) and describe up to 3 of its photos. */
export async function googlePlace(rec: PlaceRecord, deps: EnrichDeps): Promise<{ id: string; photos: Photo[] } | null> {
  if (!deps.googleKey) return null;
  const res = await deps.fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": deps.googleKey,
      "x-goog-fieldmask": "places.id,places.displayName,places.location,places.photos",
    },
    body: JSON.stringify({
      textQuery: `${rec.name} ${rec.city}`.trim(),
      maxResultCount: 5,
      locationBias: { circle: { center: { latitude: rec.latitude, longitude: rec.longitude }, radius: 500 } },
    }),
  });
  if (!res.ok) throw new Error(`google ${res.status}`);
  const places = ((await res.json()) as { places?: GooglePlace[] }).places ?? [];
  const match = places.find((p) => {
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (!p.id || typeof lat !== "number" || typeof lng !== "number") return false;
    const d = distanceMeters({ lat, lng }, { lat: rec.latitude, lng: rec.longitude });
    return d <= 50 || (d <= 200 && mentionsPlace(p.displayName?.text ?? "", rec.name, rec.city));
  });
  if (!match?.id) return null;
  const photos = (match.photos ?? []).slice(0, MAX_PHOTOS).map((ph, i) => {
    const author = ph.authorAttributions?.[0];
    return {
      // Google does not allow storing photo files or URLs; /place-photo fetches a fresh one when viewed.
      src: `/place-photo/${encodeURIComponent(match.id!)}/${i}`,
      alt: rec.name,
      credit: author?.displayName ? `Google Maps · ${author.displayName}` : "Google Maps",
      ...(author?.uri?.startsWith("https://") ? { creditUrl: author.uri } : {}),
    } satisfies Photo;
  });
  return { id: match.id, photos };
}

// --- TikTok -----------------------------------------------------------------------------------------

/** Search the web (Brave Search API) for TikTok video links about the place. */
export async function searchTikTokLinks(rec: PlaceRecord, deps: EnrichDeps): Promise<string[]> {
  if (!deps.braveKey) return [];
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", `${rec.name} ${rec.city} site:tiktok.com`);
  u.searchParams.set("count", "20");
  const res = await deps.fetch(u, { headers: { accept: "application/json", "x-subscription-token": deps.braveKey } });
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const results = ((await res.json()) as { web?: { results?: { url?: string }[] } }).web?.results ?? [];
  const ids = new Set<string>();
  const out: string[] = [];
  for (const r of results) {
    const t = r.url ? parseTikTok(r.url) : null;
    if (t && !ids.has(t.id)) {
      ids.add(t.id);
      out.push(`https://www.tiktok.com/@${t.user}/video/${t.id}`);
    }
  }
  return out.slice(0, MAX_TIKTOK_CANDIDATES);
}

/** Load each candidate video page; keep the ones whose caption is about the place (with a cover thumbnail). */
export async function verifyTikToks(rec: PlaceRecord, urls: string[], deps: EnrichDeps): Promise<{ videos: SocialVideo[]; checked: number }> {
  const videos: SocialVideo[] = [];
  let checked = 0;
  for (const url of urls) {
    if (videos.length >= MAX_TIKTOKS) break;
    checked++;
    try {
      const res = await deps.fetch(url, { headers: { "user-agent": UA } });
      if (!res.ok) continue;
      const page = parseTikTokPage(await res.text());
      if (!page || !mentionsPlace(`${page.desc} ${page.author}`, rec.name, rec.city)) continue;
      let thumb: Uint8Array | null = null;
      let thumbType: string | null = null;
      if (page.cover) {
        const img = await deps.fetch(page.cover, { headers: { "user-agent": UA } });
        if (img.ok) {
          const raw = new Uint8Array(await img.arrayBuffer());
          const small = deps.resizeThumb ? await deps.resizeThumb(raw) : { bytes: raw, type: img.headers.get("content-type") ?? "image/jpeg" };
          thumb = small.bytes;
          thumbType = small.type;
        }
      }
      videos.push({ videoId: page.id, url: `https://www.tiktok.com/@${page.author}/video/${page.id}`, label: tiktokLabel(page.author, page.desc), thumb, thumbType });
    } catch {
      // One bad candidate never stops the rest.
    }
  }
  return { videos, checked };
}

// --- Orchestration ----------------------------------------------------------------------------------

/** Find what is missing for a place. Never throws: each step's failure becomes a note. */
export async function enrichPlace(rec: PlaceRecord, deps: EnrichDeps): Promise<EnrichResult> {
  const notes: string[] = [];
  const result: EnrichResult = {
    videos: [],
    enrichment: { photos: "existing", tiktok: "existing", notes, ranAt: (deps.now?.() ?? new Date()).toISOString() },
  };

  if (rec.photos.length === 0) {
    let photos: Photo[] = [];
    try {
      photos = await commonsPhotos(rec, deps);
      if (photos.length) result.enrichment.photos = "commons";
    } catch (e) {
      notes.push(`Wikimedia Commons: ${(e as Error).message}`);
    }
    if (!photos.length) {
      if (!deps.googleKey) notes.push("Google photos are off (GOOGLE_PLACES_SERVER_KEY is not set)");
      try {
        const g = await googlePlace(rec, deps);
        if (g) {
          result.googlePlaceId = g.id;
          photos = g.photos;
          if (photos.length) result.enrichment.photos = "google";
        }
      } catch (e) {
        notes.push(`Google: ${(e as Error).message}`);
      }
    }
    if (photos.length) result.photos = photos;
    else result.enrichment.photos = "none";
  }

  const existing = rec.social.tiktok ?? [];
  if (!existing.some((url) => embedFor({ platform: "tiktok", url }))) {
    result.enrichment.tiktok = 0;
    if (!deps.braveKey) notes.push("TikTok search is off (BRAVE_SEARCH_API_KEY is not set)");
    try {
      const candidates = await searchTikTokLinks(rec, deps);
      const { videos, checked } = await verifyTikToks(rec, candidates, deps);
      result.videos = videos;
      result.enrichment.tiktok = videos.length;
      if (candidates.length) notes.push(`TikTok: ${videos.length} of ${checked} candidate videos were about this place`);
      if (videos.length) result.social = { ...rec.social, tiktok: [...existing, ...videos.map((v) => v.url)] };
    } catch (e) {
      notes.push(`TikTok search: ${(e as Error).message}`);
    }
  }
  return result;
}
