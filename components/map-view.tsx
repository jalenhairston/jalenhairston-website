"use client";

// POC: things-to-do map. MapLibre + OpenFreeMap tiles (free, no API key).
// Visitor-added places live in localStorage only (this device) and can be copied as content files.
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import Supercluster from "supercluster";
import { useEffect, useRef, useState } from "react";

export type PostLink = { platform: "tiktok" | "instagram"; url: string; title?: string };
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
const PLATFORM_LABEL = { tiktok: "TikTok", instagram: "Instagram" } as const;

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

/** TikTok first (search, then saved TikToks), then Instagram (search, then saved posts). */
function orderedLinks(p: MapPlace): (PostLink & { title?: string })[] {
  const saved = p.links.filter((l) => l.platform === "tiktok");
  const ig = p.links.filter((l) => l.platform === "instagram");
  return [
    { platform: "tiktok", url: tiktokSearchUrl(p), title: `Search “${p.name}”` },
    ...saved,
    { platform: "instagram", url: instagramSearchUrl(p), title: `Search #${instagramTag(p)}` },
    ...ig,
  ];
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
        map.addControl(new maplibre.GeolocateControl({ trackUserLocation: false }), "top-right");
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
      const index = new Supercluster<{ id: string }>({ radius: 45, minPoints: 3, maxZoom: CLUSTER_MAX_ZOOM });
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
            "grid size-12 place-items-center rounded-full border-[3px] border-white bg-accent text-base font-bold text-accent-ink shadow-soft";
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
          tile.classList.add("grid", "place-items-center", "text-2xl");
          tile.textContent = CATEGORY_EMOJI[p.category] ?? CATEGORY_EMOJI.other;
        }
        const label = document.createElement("span");
        label.setAttribute("aria-hidden", "true");
        label.textContent = p.name;
        label.className =
          "map-pin-label pointer-events-none absolute top-full left-1/2 mt-1 max-w-32 -translate-x-1/2 truncate rounded-pill bg-white/90 px-2 py-0.5 text-[11px] leading-tight font-semibold text-ink shadow-soft";
        el.append(tile, label);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (addModeRef.current) return;
          setSelectedId(p.id);
        });
        return new MarkerCtor({ element: el }).setLngLat([lng, lat]).addTo(map);
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, places, userPlaces, selectedId, zoom]);

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
          {selected.photos.length > 0 && (
            <ul aria-label="Photos" className="-mx-5 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1">
              {selected.photos.map((ph) => (
                <li key={ph.src} className="shrink-0 snap-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.src} alt={ph.alt} loading="lazy" className="h-32 w-44 rounded-2xl bg-tag object-cover" />
                  {ph.credit && (
                    <p className="mt-1 max-w-44 truncate text-[11px] text-muted">
                      {ph.creditUrl ? (
                        <a href={ph.creditUrl} target="_blank" rel="noopener noreferrer" className="underline">
                          {ph.credit}
                        </a>
                      ) : (
                        ph.credit
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {selected.description && <p className="mt-3 text-sm whitespace-pre-line">{selected.description}</p>}
          <ul className="mt-4 space-y-2">
            {orderedLinks(selected).map((l, i) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex min-h-11 items-center justify-between gap-3 rounded-pill px-4 py-2 text-sm font-semibold ${i === 0 ? "bg-accent text-accent-ink" : "bg-tag"}`}
                >
                  <span>
                    {PLATFORM_LABEL[l.platform]}
                    {l.title && <span className={`font-normal ${i === 0 ? "opacity-80" : "text-muted"}`}> · {l.title}</span>}
                  </span>
                  <span aria-hidden>↗</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
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
