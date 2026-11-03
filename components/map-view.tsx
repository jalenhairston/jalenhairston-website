"use client";

// POC: things-to-do map. MapLibre + OpenFreeMap tiles (free, no API key).
// Visitor-added places live in localStorage only (this device) and can be copied as content files.
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import Supercluster from "supercluster";
import { canWarm, embedFor } from "@/lib/social";
import { useEffect, useRef, useState } from "react";

export type PostLink = { platform: "tiktok" | "instagram"; url: string; title?: string; thumb?: string };
export type Photo = { src: string; alt: string; credit?: string; creditUrl?: string };
export type MapPlace = {
  id: string;
  name: string;
  city: string;
  category: string;
  lat: number;
  lng: number;
  description: string;
  photos: Photo[];
  links: PostLink[];
  userAdded: boolean;
};

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const STORAGE_KEY = "map-user-places-v1";
const CATEGORIES = ["food", "drinks", "coffee", "outdoors", "culture", "nightlife", "shopping", "other"] as const;
const CATEGORY_EMOJI: Record<string, string> = {
  food: "🍽️",
  drinks: "🍸",
  coffee: "☕",
  outdoors: "🌳",
  culture: "🏛️",
  nightlife: "🌙",
  shopping: "🛍️",
  other: "📍",
};
/** Pins cluster up to this zoom; selecting a place flies one level past it so it always shows alone. */
const CLUSTER_MAX_ZOOM = 14;
const PLATFORM_LABEL = { tiktok: "TikTok", instagram: "Instagram", google: "Google" } as const;
type ShownLink = { platform: keyof typeof PLATFORM_LABEL; url: string; title?: string; thumb?: string };

function platformOf(url: string): PostLink["platform"] | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  } catch {}
  return undefined;
}

const tiktokSearchUrl = (p: MapPlace) => `https://www.tiktok.com/search?q=${encodeURIComponent(`${p.name} ${p.city}`)}`;

/** Instagram has no stable logged-out text search URL, so search the place's hashtag (e.g. #neptuneoyster). */
const instagramTag = (p: MapPlace) => p.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const instagramSearchUrl = (p: MapPlace) => `https://www.instagram.com/explore/tags/${instagramTag(p)}/`;

/** Apple Maps: opens the Maps app on iPhone/iPad/Mac, and Apple Maps on the web elsewhere. */
const appleMapsUrl = (p: MapPlace) => `https://maps.apple.com/?ll=${p.lat},${p.lng}&q=${encodeURIComponent(p.name)}`;

const googleSearchUrl = (p: MapPlace) => `https://www.google.com/search?q=${encodeURIComponent(`${p.name} ${p.city}`)}`;

/** Saved TikToks for the dropdown, with a TikTok search as the last row (and the only one if none are saved). */
function tiktokLinks(p: MapPlace): { saved: ShownLink[]; search: ShownLink } {
  return {
    saved: p.links.filter((l) => l.platform === "tiktok"),
    search: { platform: "tiktok", url: tiktokSearchUrl(p), title: `Search “${p.name}”` },
  };
}

/** Below the TikTok dropdown: Instagram (search, then saved posts), then Google. */
function otherLinks(p: MapPlace): ShownLink[] {
  return [
    { platform: "instagram", url: instagramSearchUrl(p), title: `Search #${instagramTag(p)}` },
    ...p.links.filter((l) => l.platform === "instagram"),
    { platform: "google", url: googleSearchUrl(p), title: `Search “${p.name}”` },
  ];
}

// --- Background warm-up -------------------------------------------------------------------------
// When a place is broken out of a cluster we pre-fetch its (self-hosted, immutable) video thumbnails
// at idle priority, nearest to the map centre first, so the TikTok dropdown opens instantly.
// The embeds themselves are never pre-loaded: TikTok/Instagram serve them `no-store` (uncacheable,
// ~1MB each), so they only load when someone taps play.
const MAX_WARM_PLACES = 30;
const THUMBS_PER_PLACE = 4;
const warmed = new Set<string>();
const warmQueue: MapPlace[] = [];
const warmImages: HTMLImageElement[] = []; // keep references until loaded
let warmScheduled = false;

function warmNow(p: MapPlace) {
  if (warmed.has(p.id) || warmed.size >= MAX_WARM_PLACES) return;
  warmed.add(p.id);
  for (const l of p.links.filter((x) => x.thumb).slice(0, THUMBS_PER_PLACE)) {
    const img = new Image();
    img.decoding = "async";
    img.src = l.thumb!;
    warmImages.push(img);
  }
}

function drainWarmQueue() {
  warmScheduled = false;
  for (let i = 0; i < 2 && warmQueue.length; i++) warmNow(warmQueue.shift()!);
  if (warmQueue.length) scheduleDrain();
}

function scheduleDrain() {
  if (warmScheduled) return;
  warmScheduled = true;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(drainWarmQueue, { timeout: 2000 });
  else setTimeout(drainWarmQueue, 200);
}

function warmPlaces(places: MapPlace[], center: { lat: number; lng: number }) {
  if (!canWarm((navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection)) return;
  const dist = (p: MapPlace) => (p.lat - center.lat) ** 2 + (p.lng - center.lng) ** 2;
  for (const p of places) {
    if (warmed.has(p.id) || warmQueue.some((q) => q.id === p.id) || !p.links.some((l) => l.thumb)) continue;
    warmQueue.push(p);
  }
  warmQueue.sort((a, b) => dist(a) - dist(b));
  if (warmQueue.length) scheduleDrain();
}

/** Open a connection to the embed host just before it is needed (first dropdown open / play). */
function preconnect(origin: string) {
  if (document.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = origin;
  document.head.append(link);
}

function loadUserPlaces(): MapPlace[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? (parsed as MapPlace[])
          .filter((p) => typeof p?.lat === "number" && typeof p?.lng === "number")
          .map((p) => ({ ...p, photos: Array.isArray(p.photos) ? p.photos : [], links: Array.isArray(p.links) ? p.links : [] }))
      : [];
  } catch {
    return [];
  }
}

function toMarkdown(p: MapPlace): string {
  const links = p.links.map((l) => `  - { platform: ${l.platform}, url: "${l.url}" }`).join("\n");
  const photos = p.photos.length ? `photos:\n${p.photos.map((x) => `  - { src: "${x.src}", alt: "${x.alt.replaceAll('"', '\\"')}" }`).join("\n")}\n` : "";
  return `---\nsample: false\nname: "${p.name.replaceAll('"', '\\"')}"\ncity: "${p.city.replaceAll('"', '\\"')}"\ncategory: ${p.category}\nlat: ${p.lat.toFixed(5)}\nlng: ${p.lng.toFixed(5)}\n${photos}links:\n${links}\n---\n${p.description}\n`;
}

export function MapView({ places }: { places: MapPlace[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const addModeRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [userPlaces, setUserPlaces] = useState<MapPlace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftPoint, setDraftPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [full, setFull] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const all = [...places, ...userPlaces];
  const selected = all.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    // Hydrate from localStorage after mount (not available during prerender).
    const saved = loadUserPlaces();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved.length > 0) setUserPlaces(saved);
  }, []);

  useEffect(() => {
    addModeRef.current = adding;
  }, [adding]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        maplibre.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
        if (cancelled || !containerRef.current) return;
        map = new maplibre.Map({
          container: containerRef.current,
          style: STYLE_URL,
          center: [-30, 30],
          zoom: 1.4,
          attributionControl: { compact: true },
        });
        if (places.length > 0) {
          // Start on the city with the most places; the rest of the world is a zoom-out away.
          const counts = new Map<string, number>();
          places.forEach((p) => counts.set(p.city, (counts.get(p.city) ?? 0) + 1));
          const home = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0];
          const bounds = new maplibre.LngLatBounds();
          places.filter((p) => p.city === home).forEach((p) => bounds.extend([p.lng, p.lat]));
          map.fitBounds(bounds, { padding: { top: 100, bottom: 100, left: 70, right: 70 }, maxZoom: 13, duration: 0 });
        }
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        setZoom(Math.floor(map.getZoom()));
        map.on("zoomend", () => setZoom(Math.floor(map!.getZoom())));
        map.on("click", (e) => {
          if (!addModeRef.current) return;
          setDraftPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
          setAdding(false);
        });
        map.on("error", (e) => {
          // Style/tile fetch failure with nothing drawn: surface it instead of a blank box.
          if (!map?.isStyleLoaded() && !map?.loaded()) setMapError(true);
          console.warn("map error", e.error);
        });
        mapRef.current = map;
        setMapReady(true);
      } catch {
        setMapError(true);
      }
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
    // Created once; later place changes only update markers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers whenever the place list or selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    (async () => {
      const { Marker: MarkerCtor } = await import("maplibre-gl");
      if (cancelled) return;
      markersRef.current.forEach((m) => m.remove());
      const byId = new Map(all.map((p) => [p.id, p]));
      const index = new Supercluster<{ id: string }>({ radius: 32, minPoints: 3, maxZoom: CLUSTER_MAX_ZOOM });
      index.load(
        all.map((p) => ({
          type: "Feature" as const,
          properties: { id: p.id },
          geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        })),
      );
      const items = index.getClusters([-180, -85, 180, 85], zoom);
      markersRef.current = items.map((item) => {
        const [lng, lat] = item.geometry.coordinates as [number, number];
        const props = item.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; id?: string };
        if (props.cluster) {
          const count = props.point_count ?? 0;
          const el = document.createElement("button");
          el.type = "button";
          el.setAttribute("aria-label", `${count} places, zoom in`);
          el.className =
            "grid size-11 place-items-center rounded-full border-[3px] border-white bg-accent text-sm font-bold text-accent-ink shadow-soft";
          el.style.zIndex = "2";
          el.textContent = String(count);
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (addModeRef.current) return;
            map.easeTo({
              center: [lng, lat],
              zoom: Math.min(index.getClusterExpansionZoom(props.cluster_id as number), CLUSTER_MAX_ZOOM + 1),
              duration: 500,
            });
          });
          return new MarkerCtor({ element: el }).setLngLat([lng, lat]).addTo(map);
        }
        const p = byId.get(props.id as string)!;
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", `${p.name}, ${p.city}`);
        const active = p.id === selectedId;
        el.className = `map-pin group relative block rounded-2xl transition-transform ${active ? "scale-110" : ""}`;
        el.style.zIndex = active ? "10" : "1";
        const tile = document.createElement("span");
        tile.className = `block size-full overflow-hidden rounded-2xl border-[3px] shadow-soft ${p.userAdded ? "border-amber-500" : "border-white"} ${p.photos[0] ? "bg-surface" : "bg-tag"}`;
        const thumb = p.photos[0];
        if (thumb) {
          const img = document.createElement("img");
          img.src = thumb.src;
          img.alt = "";
          img.loading = "lazy";
          img.draggable = false;
          img.className = "size-full object-cover";
          tile.append(img);
        } else {
          tile.classList.add("grid", "place-items-center", "text-xl");
          tile.textContent = CATEGORY_EMOJI[p.category] ?? CATEGORY_EMOJI.other;
        }
        const label = document.createElement("span");
        label.setAttribute("aria-hidden", "true");
        label.textContent = p.name;
        label.className =
          "map-pin-label pointer-events-none absolute top-full left-1/2 mt-1 max-w-28 -translate-x-1/2 truncate rounded-pill bg-white/90 px-1.5 py-0.5 text-[10px] leading-tight font-semibold text-ink shadow-soft";
        el.append(tile, label);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (addModeRef.current) return;
          setSelectedId(p.id);
        });
        return new MarkerCtor({ element: el }).setLngLat([lng, lat]).addTo(map);
      });
      // Places now showing as individual pins get their thumbnails warmed in the background.
      const c = map.getCenter();
      warmPlaces(
        items.flatMap((it) => {
          const props = it.properties as { cluster?: boolean; id?: string };
          return props.cluster ? [] : [byId.get(props.id as string)!];
        }),
        { lat: c.lat, lng: c.lng },
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, places, userPlaces, selectedId, zoom]);

  // Opening a card warms that place's thumbnails right away (no-op if already warmed).
  useEffect(() => {
    const p = [...places, ...userPlaces].find((x) => x.id === selectedId);
    if (p) warmNow(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Fly to whichever place gets selected (pin tap or the hidden list).
  useEffect(() => {
    const map = mapRef.current;
    const p = [...places, ...userPlaces].find((x) => x.id === selectedId);
    if (!map || !mapReady || !p) return;
    // On phones the bottom sheet covers the lower half, so keep the pin in the visible top part.
    const bottom = window.innerWidth < 640 ? Math.round(map.getContainer().clientHeight * 0.55) : 0;
    map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), CLUSTER_MAX_ZOOM + 1), duration: 600, padding: { bottom } });
    // Only re-run when the selection changes, not when the lists update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, mapReady]);

  // Location is on by default: watch the position and keep a blue dot on the map. (The browser still
  // asks permission once; if it is declined we say so and carry on without a dot.)
  useEffect(() => {
    if (!mapReady || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoError(null);
      },
      (err) =>
        setGeoError(
          err.code === 1
            ? "Location is blocked. Allow it for this site in your browser settings to see where you are."
            : "Couldn't find your location. Try again outdoors or with location services on.",
        ),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [mapReady]);

  // Draw / move the user's dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !userPos) return;
    let cancelled = false;
    (async () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat([userPos.lng, userPos.lat]);
        return;
      }
      const { Marker: MarkerCtor } = await import("maplibre-gl");
      if (cancelled || userMarkerRef.current) return;
      const el = document.createElement("div");
      el.dataset.testid = "user-location";
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", "Your location");
      el.className = "size-4 rounded-full border-2 border-white bg-blue-600 shadow-soft";
      el.style.boxShadow = "0 0 0 7px rgb(37 99 235 / 0.25)";
      el.style.pointerEvents = "none";
      el.style.zIndex = "5";
      userMarkerRef.current = new MarkerCtor({ element: el }).setLngLat([userPos.lng, userPos.lat]).addTo(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, userPos]);

  useEffect(
    () => () => {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
    },
    [],
  );

  // Location notices fade on their own so they never sit over the map for long.
  useEffect(() => {
    if (!geoError) return;
    const t = setTimeout(() => setGeoError(null), 9000);
    return () => clearTimeout(t);
  }, [geoError]);

  function centerOnMe() {
    const map = mapRef.current;
    if (!map) return;
    if (userPos) {
      setGeoError(null);
      map.easeTo({ center: [userPos.lng, userPos.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
      return;
    }
    // No fix yet (still waiting, or permission was declined): ask once more so the prompt can reappear.
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoError(null);
        map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(map.getZoom(), 15), duration: 600 });
      },
      () =>
        setGeoError("Location is blocked or unavailable. Allow it for this site in your browser settings to see where you are."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  // Escape closes the card / cancels add mode; with nothing open it leaves full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedId || adding || draftPoint) {
        setSelectedId(null);
        setAdding(false);
        setDraftPoint(null);
      } else {
        setFull(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, adding, draftPoint]);

  // Full screen: a fixed overlay that works everywhere (iOS Safari has no Fullscreen API for
  // elements), plus the native Fullscreen API where it exists to hide the browser chrome.
  useEffect(() => {
    if (!full) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    try {
      shellRef.current?.requestFullscreen?.().catch(() => {});
    } catch {}
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.body.style.overflow = prevOverflow;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [full]);

  // The map must re-measure its container whenever the shell changes size.
  useEffect(() => {
    const id = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(id);
  }, [full, mapReady]);

  function savePlace(p: MapPlace) {
    const next = [...userPlaces, p];
    setUserPlaces(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    setDraftPoint(null);
    setSelectedId(p.id);
  }

  function removePlace(id: string) {
    const next = userPlaces.filter((p) => p.id !== id);
    setUserPlaces(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    setSelectedId(null);
  }

  async function copyMarkdown(p: MapPlace) {
    try {
      await navigator.clipboard.writeText(toMarkdown(p));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div
      ref={shellRef}
      data-testid="map-shell"
      data-fullscreen={full}
      className={
        full
          ? "fixed inset-0 z-50 h-dvh overflow-hidden bg-tag"
          : "relative h-[calc(100dvh-9.5rem)] min-h-[26rem] overflow-hidden rounded-card bg-tag shadow-soft"
      }
    >
      {/* MapLibre forces position:relative on its container, so size it via a wrapper. */}
      <div className={`absolute inset-0 ${adding ? "cursor-crosshair" : ""}`}>
        <div ref={containerRef} className="h-full w-full" />
      </div>

      {geoError && !adding && (
        <p
          role="alert"
          className="absolute top-16 left-3 z-10 max-w-[calc(100%-5.5rem)] rounded-card bg-surface px-4 py-2 text-sm shadow-soft"
        >
          {geoError}
        </p>
      )}

      {mapError && (
        <p role="alert" className="absolute inset-x-4 top-4 z-10 rounded-card bg-surface p-4 text-sm shadow-soft">
          The map couldn&apos;t load. Check your connection and refresh.
        </p>
      )}

      {/* No-JS / screen reader friendly list of the same places. */}
      <ul className="sr-only">
        {all.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setSelectedId(p.id)}>
              {p.name}, {p.city} ({p.category})
            </button>
          </li>
        ))}
      </ul>

      <div className="absolute top-3 left-3 z-10 flex gap-2" style={full ? { top: "max(0.75rem, env(safe-area-inset-top))" } : undefined}>
        <button
          type="button"
          onClick={() => {
            setSelectedId(null);
            setDraftPoint(null);
            setAdding((a) => !a);
          }}
          aria-pressed={adding}
          className="min-h-11 rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-soft"
        >
          {adding ? "Cancel" : "+ Add place"}
        </button>
        <button
          type="button"
          onClick={() => setFull((f) => !f)}
          aria-pressed={full}
          aria-label={full ? "Exit full screen" : "Full screen"}
          className="grid min-h-11 min-w-11 place-items-center rounded-pill bg-surface px-3 text-base font-semibold shadow-soft"
        >
          <span aria-hidden>{full ? "✕" : "⛶"}</span>
        </button>
        <button
          type="button"
          onClick={centerOnMe}
          aria-label="Center on my location"
          className="grid min-h-11 min-w-11 place-items-center rounded-pill bg-surface px-3 text-base font-semibold shadow-soft"
        >
          <span aria-hidden>◎</span>
        </button>
      </div>

      {adding && (
        <p role="status" className="absolute top-16 left-3 z-10 rounded-pill bg-surface px-4 py-2 text-sm shadow-soft">
          Tap the map where the place is
        </p>
      )}

      {selected && !draftPoint && (
        <section
          aria-label={selected.name}
          className="absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto rounded-t-card bg-surface p-5 pb-6 shadow-soft sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-96 sm:rounded-card"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold leading-tight">{selected.name}</h2>
              <p className="mt-1 text-sm text-muted">
                {selected.city} · <span className="capitalize">{selected.category}</span>
                {selected.userAdded && " · added by you"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
              className="grid size-10 shrink-0 place-items-center rounded-pill bg-tag text-lg"
            >
              ×
            </button>
          </div>
          <a
            href={appleMapsUrl(selected)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-pill bg-tag px-4 py-2 text-sm font-semibold"
          >
            <span aria-hidden>📍</span>
            Open in Apple Maps
            <span aria-hidden>↗</span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          {selected.photos.length > 0 && (
            <ul aria-label="Photos" className="-mx-5 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1">
              {selected.photos.map((ph) => (
                <li key={ph.src} className="shrink-0 snap-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.src} alt={ph.alt} loading="lazy" className="h-32 w-44 rounded-2xl bg-tag object-cover" />
                </li>
              ))}
            </ul>
          )}
          {selected.description && <p className="mt-3 text-sm whitespace-pre-line">{selected.description}</p>}
          <div className="mt-4 space-y-2">
            <TikTokSection key={`tiktok-${selected.id}`} place={selected} />
            <OtherLinks key={`other-${selected.id}`} place={selected} />
          </div>
          {selected.userAdded && (
            <div className="mt-4 flex gap-2 text-sm">
              <button type="button" onClick={() => copyMarkdown(selected)} className="min-h-11 rounded-pill bg-tag px-4 py-2 font-semibold">
                {copied ? "Copied!" : "Copy as content file"}
              </button>
              <button type="button" onClick={() => removePlace(selected.id)} className="min-h-11 rounded-pill px-4 py-2 text-muted underline">
                Remove
              </button>
            </div>
          )}
        </section>
      )}

      {draftPoint && (
        <AddPlaceForm
          point={draftPoint}
          onCancel={() => setDraftPoint(null)}
          onSave={(p) => savePlace(p)}
        />
      )}
    </div>
  );
}

function AddPlaceForm({
  point,
  onSave,
  onCancel,
}: {
  point: { lat: number; lng: number };
  onSave: (p: MapPlace) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const url = String(f.get("url") ?? "").trim();
    const platform = platformOf(url);
    if (!platform) return setError("Link must be a TikTok or Instagram URL (https://…).");
    const photo = String(f.get("photo") ?? "").trim();
    const name = String(f.get("name")).trim();
    onSave({
      id: `user-${Date.now()}`,
      name,
      city: String(f.get("city")).trim(),
      category: String(f.get("category")),
      lat: point.lat,
      lng: point.lng,
      description: String(f.get("description") ?? "").trim(),
      photos: photo.startsWith("https://") ? [{ src: photo, alt: name }] : [],
      links: [{ platform, url }],
      userAdded: true,
    });
  }

  const field = "mt-1 block min-h-11 w-full rounded-pill border border-line bg-surface px-4 py-2 text-base";
  return (
    <form
      onSubmit={submit}
      aria-label="Add a place"
      className="absolute inset-x-0 bottom-0 z-30 max-h-[85%] space-y-3 overflow-y-auto rounded-t-card bg-surface p-5 pb-6 shadow-soft sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-96 sm:rounded-card"
    >
      <h2 className="text-lg font-semibold">Add a place</h2>
      <label className="block text-sm font-semibold">
        Name
        <input ref={nameRef} name="name" required className={field} />
      </label>
      <label className="block text-sm font-semibold">
        City
        <input name="city" required className={field} />
      </label>
      <label className="block text-sm font-semibold">
        Category
        <select name="category" className={field} defaultValue="food">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        TikTok or Instagram link
        <input name="url" type="url" required inputMode="url" placeholder="https://www.tiktok.com/…" className={field} />
      </label>
      <label className="block text-sm font-semibold">
        Photo link (optional)
        <input name="photo" type="url" inputMode="url" placeholder="https://…/photo.jpg" className={field} />
      </label>
      <label className="block text-sm font-semibold">
        Description
        <textarea name="description" rows={2} className={`${field} rounded-card`} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <p className="text-xs text-muted">Saved in this browser only. Copy it as a content file to add it to the site.</p>
      <div className="flex gap-2">
        <button type="submit" className="min-h-11 rounded-pill bg-accent px-5 py-2 text-sm font-semibold text-accent-ink">
          Save
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-pill px-5 py-2 text-sm text-muted underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

const rowLink = "flex min-h-11 items-center justify-between gap-3 rounded-pill px-4 py-2 text-sm";

/** TikTok dropdown: each saved video is a thumbnail row; tapping it swaps in the official embed. */
function TikTokSection({ place }: { place: MapPlace }) {
  const { saved, search } = tiktokLinks(place);
  const [playing, setPlaying] = useState<string | null>(null);

  if (saved.length === 0) {
    return (
      <a href={search.url} target="_blank" rel="noopener noreferrer" className={`${rowLink} bg-accent font-semibold text-accent-ink`}>
        <span>
          TikTok<span className="font-normal opacity-80"> · {search.title}</span>
        </span>
        <span aria-hidden>↗</span>
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }
  return (
    <details
      className="group rounded-[1.375rem] bg-accent text-accent-ink"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) preconnect("https://www.tiktok.com");
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-pill px-4 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          TikTok
          <span className="font-normal opacity-80">
            {" "}
            · {saved.length} {saved.length === 1 ? "link" : "links"}
          </span>
        </span>
        <span aria-hidden className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ul className="space-y-1 px-2 pb-2">
        {[...saved, search].map((l) => (
          <EmbedRow key={l.url} link={l} brand="TikTok" tone="accent" playing={playing === l.url} onPlay={() => setPlaying(l.url)} onClose={() => setPlaying(null)} />
        ))}
      </ul>
    </details>
  );
}

type EmbedRowProps = { link: ShownLink; brand: "TikTok" | "Instagram"; tone: "accent" | "light"; playing: boolean; onPlay: () => void; onClose: () => void };

function EmbedRow({ link, brand, tone, playing, onPlay, onClose }: EmbedRowProps) {
  const embed = embedFor(link);
  const origin = brand === "TikTok" ? "https://www.tiktok.com" : "https://www.instagram.com";
  const chip = tone === "accent" ? "bg-white/15 hover:bg-white/25" : "bg-tag hover:bg-line";
  const open = (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`grid size-11 shrink-0 place-items-center rounded-pill ${chip}`}
    >
      <span aria-hidden>↗</span>
      <span className="sr-only">{link.title ? `Open “${link.title}” on ${brand} (opens in a new tab)` : `Open on ${brand} (opens in a new tab)`}</span>
    </a>
  );

  // Not a single video (search, profile, tag, place page): a plain link row.
  if (!embed) {
    return (
      <li>
        <a href={link.url} target="_blank" rel="noopener noreferrer" className={`${rowLink} ${chip}`}>
          <span className="line-clamp-2">{link.title ?? link.url}</span>
          <span aria-hidden>↗</span>
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </li>
    );
  }

  return (
    <li className={`rounded-2xl p-2 ${tone === "accent" ? "bg-white/15" : "bg-tag"}`}>
      {playing ? (
        <div>
          {/* Loaded only on tap: embeds are no-store and ~1MB, so they are never pre-fetched. */}
          <iframe
            src={embed.src}
            title={embed.title}
            loading="lazy"
            allow="autoplay; fullscreen; encrypted-media; clipboard-write"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            className="mx-auto block h-[520px] w-full max-w-[325px] rounded-xl bg-black"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" onClick={onClose} className={`min-h-11 rounded-pill px-4 text-sm font-semibold ${chip}`}>
              Close player
            </button>
            {open}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              preconnect(origin);
              onPlay();
            }}
            className="flex min-h-14 flex-1 items-center gap-3 rounded-xl text-left"
            aria-label={`Play: ${link.title ?? `${brand} video`}`}
          >
            <span className="relative block h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-black/30">
              {link.thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={link.thumb} alt="" loading="lazy" decoding="async" width={48} height={64} className="size-full object-cover" />
              )}
              <span aria-hidden className="absolute inset-0 grid place-items-center bg-black/25 text-lg">
                ▶
              </span>
            </span>
            <span className="line-clamp-3 text-sm">{link.title ?? `${brand} video`}</span>
          </button>
          {open}
        </div>
      )}
    </li>
  );
}

/** Instagram search, any saved Instagram posts (reels play inline), then Google. */
function OtherLinks({ place }: { place: MapPlace }) {
  const [playing, setPlaying] = useState<string | null>(null);
  return (
    <ul className="space-y-2">
      {otherLinks(place).map((l) =>
        l.platform === "instagram" && embedFor(l) ? (
          <EmbedRow key={l.url} link={l} brand="Instagram" tone="light" playing={playing === l.url} onPlay={() => setPlaying(l.url)} onClose={() => setPlaying(null)} />
        ) : (
          <li key={l.url}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-between gap-3 rounded-pill bg-tag px-4 py-2 text-sm font-semibold"
            >
              <span>
                {PLATFORM_LABEL[l.platform]}
                {l.title && <span className="font-normal text-muted"> · {l.title}</span>}
              </span>
              <span aria-hidden>↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ),
      )}
    </ul>
  );
}
