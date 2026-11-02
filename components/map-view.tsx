"use client";

// POC: things-to-do map. MapLibre + OpenFreeMap tiles (free, no API key).
// Visitor-added places live in localStorage only (this device) and can be copied as content files.
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

export type PostLink = { platform: "tiktok" | "instagram"; url: string; title?: string };
export type MapPlace = {
  id: string;
  name: string;
  city: string;
  category: string;
  lat: number;
  lng: number;
  description: string;
  links: PostLink[];
  userAdded: boolean;
};

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const STORAGE_KEY = "map-user-places-v1";
const CATEGORIES = ["food", "drinks", "coffee", "outdoors", "culture", "nightlife", "shopping", "other"] as const;
const PLATFORM_LABEL = { tiktok: "TikTok", instagram: "Instagram" } as const;

function platformOf(url: string): PostLink["platform"] | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  } catch {}
  return undefined;
}

function loadUserPlaces(): MapPlace[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as MapPlace[]).filter((p) => typeof p?.lat === "number" && typeof p?.lng === "number") : [];
  } catch {
    return [];
  }
}

function toMarkdown(p: MapPlace): string {
  const links = p.links.map((l) => `  - { platform: ${l.platform}, url: "${l.url}" }`).join("\n");
  return `---\nsample: false\nname: "${p.name.replaceAll('"', '\\"')}"\ncity: "${p.city.replaceAll('"', '\\"')}"\ncategory: ${p.category}\nlat: ${p.lat.toFixed(5)}\nlng: ${p.lng.toFixed(5)}\nlinks:\n${links}\n---\n${p.description}\n`;
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
          const bounds = new maplibre.LngLatBounds();
          places.forEach((p) => bounds.extend([p.lng, p.lat]));
          map.fitBounds(bounds, { padding: 70, maxZoom: 10, duration: 0 });
        }
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibre.GeolocateControl({ trackUserLocation: false }), "top-right");
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
      markersRef.current = all.map((p) => {
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", `${p.name}, ${p.city}`);
        const active = p.id === selectedId;
        el.className = [
          "size-9 rounded-full border-2 border-white shadow-soft grid place-items-center text-xs font-bold transition-transform",
          p.userAdded ? "bg-amber-500 text-black" : "bg-accent text-accent-ink",
          active ? "scale-125" : "",
        ].join(" ");
        el.textContent = p.category.slice(0, 1).toUpperCase();
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (addModeRef.current) return;
          setSelectedId(p.id);
          // On phones the bottom sheet covers the lower half, so keep the pin in the visible top part.
          const bottom = window.innerWidth < 640 ? Math.round(map.getContainer().clientHeight * 0.55) : 0;
          map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 12), duration: 600, padding: { bottom } });
        });
        return new MarkerCtor({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, places, userPlaces, selectedId]);

  // Escape closes the card / cancels add mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelectedId(null);
      setAdding(false);
      setDraftPoint(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
    <div className="relative h-[calc(100dvh-9.5rem)] min-h-[26rem] overflow-hidden rounded-card bg-tag shadow-soft">
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

      <button
        type="button"
        onClick={() => {
          setSelectedId(null);
          setDraftPoint(null);
          setAdding((a) => !a);
        }}
        aria-pressed={adding}
        className="absolute top-3 left-3 z-10 rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-soft"
      >
        {adding ? "Cancel" : "+ Add place"}
      </button>

      {adding && (
        <p role="status" className="absolute top-14 left-3 z-10 rounded-pill bg-surface px-4 py-2 text-sm shadow-soft">
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
          {selected.description && <p className="mt-3 text-sm whitespace-pre-line">{selected.description}</p>}
          <ul className="mt-4 space-y-2">
            {selected.links.map((l) => (
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
    onSave({
      id: `user-${Date.now()}`,
      name: String(f.get("name")).trim(),
      city: String(f.get("city")).trim(),
      category: String(f.get("category")),
      lat: point.lat,
      lng: point.lng,
      description: String(f.get("description") ?? "").trim(),
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
