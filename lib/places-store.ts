// Storage for places. `pgStore` runs on any Postgres reachable through a `query(text, params)` function
// (Neon's HTTP driver in production, PGlite in tests). `memoryStore` is the no-database fallback used in
// local development and end-to-end tests. Framework-free.
import type { Photo, PlaceRecord, Social, SocialVideo, ValidPlaceInput } from "./places-model";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export type PlacePatch = {
  photos?: Photo[];
  social?: Social;
  googlePlaceId?: string | null;
  enrichment?: Record<string, unknown>;
  enrichedAt?: string | null;
};

export interface PlaceStore {
  kind: "database" | "memory";
  list(): Promise<PlaceRecord[]>;
  get(id: string): Promise<PlaceRecord | null>;
  create(input: ValidPlaceInput): Promise<PlaceRecord>;
  update(id: string, patch: PlacePatch): Promise<PlaceRecord | null>;
  remove(id: string): Promise<boolean>;
  count(): Promise<number>;
  upsertVideo(v: SocialVideo): Promise<void>;
  /** Labels for every cached video, and whether a thumbnail is stored (bytes are fetched separately). */
  listVideos(): Promise<{ videoId: string; label: string | null; hasThumb: boolean }[]>;
  getVideoThumb(videoId: string): Promise<{ bytes: Uint8Array; type: string } | null>;
}

const COLS =
  "id, name, address, description, social, latitude, longitude, city, category, photos, google_place_id, enriched_at, enrichment, created_at, updated_at";

const json = <T>(v: unknown, fallback: T): T => (typeof v === "string" ? (JSON.parse(v) as T) : ((v as T) ?? fallback));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function toRecord(r: Record<string, unknown>): PlaceRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    address: r.address == null ? null : String(r.address),
    description: String(r.description ?? ""),
    social: json(r.social, {}),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    city: String(r.city ?? ""),
    category: String(r.category ?? "other"),
    photos: json(r.photos, []),
    googlePlaceId: r.google_place_id == null ? null : String(r.google_place_id),
    enrichedAt: r.enriched_at == null ? null : iso(r.enriched_at),
    enrichment: json(r.enrichment, {}),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const PATCH_COLUMNS: Record<keyof PlacePatch, [column: string, cast: string, encode: (v: never) => unknown]> = {
  photos: ["photos", "::jsonb", (v: Photo[]) => JSON.stringify(v)],
  social: ["social", "::jsonb", (v: Social) => JSON.stringify(v)],
  googlePlaceId: ["google_place_id", "", (v: string | null) => v],
  enrichment: ["enrichment", "::jsonb", (v: Record<string, unknown>) => JSON.stringify(v)],
  enrichedAt: ["enriched_at", "::timestamptz", (v: string | null) => v],
};

export function pgStore(query: Query): PlaceStore {
  return {
    kind: "database",
    async list() {
      return (await query(`SELECT ${COLS} FROM "Place" ORDER BY created_at, id`)).map(toRecord);
    },
    async get(id) {
      const rows = await query(`SELECT ${COLS} FROM "Place" WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async create(p) {
      const rows = await query(
        `INSERT INTO "Place" (id, name, address, description, social, latitude, longitude, city, category, photos)
         VALUES (COALESCE($1, gen_random_uuid()::text), $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb)
         RETURNING ${COLS}`,
        [p.id ?? null, p.name, p.address, p.description, JSON.stringify(p.social), p.latitude, p.longitude, p.city, p.category, JSON.stringify(p.photos)],
      );
      return toRecord(rows[0]);
    },
    async update(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, [column, cast, encode]] of Object.entries(PATCH_COLUMNS) as [keyof PlacePatch, (typeof PATCH_COLUMNS)[keyof PlacePatch]][]) {
        if (patch[key] === undefined) continue;
        params.push((encode as (v: unknown) => unknown)(patch[key]));
        sets.push(`${column} = $${params.length}${cast}`);
      }
      if (sets.length === 0) return this.get(id);
      const rows = await query(`UPDATE "Place" SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING ${COLS}`, params);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async remove(id) {
      return (await query(`DELETE FROM "Place" WHERE id = $1 RETURNING id`, [id])).length > 0;
    },
    async count() {
      return Number((await query(`SELECT count(*)::int AS n FROM "Place"`))[0].n);
    },
    async upsertVideo(v) {
      // Bytes travel as hex text so every Postgres driver handles them the same way.
      await query(
        `INSERT INTO "SocialVideo" (video_id, url, label, thumb, thumb_type)
         VALUES ($1, $2, $3, CASE WHEN $4::text IS NULL THEN NULL ELSE decode($4::text, 'hex') END, $5)
         ON CONFLICT (video_id) DO UPDATE SET url = EXCLUDED.url, label = COALESCE(EXCLUDED.label, "SocialVideo".label),
           thumb = COALESCE(EXCLUDED.thumb, "SocialVideo".thumb), thumb_type = COALESCE(EXCLUDED.thumb_type, "SocialVideo".thumb_type),
           fetched_at = now()`,
        [v.videoId, v.url, v.label, v.thumb ? Buffer.from(v.thumb).toString("hex") : null, v.thumbType ?? null],
      );
    },
    async listVideos() {
      return (await query(`SELECT video_id, label, thumb IS NOT NULL AS has_thumb FROM "SocialVideo"`)).map((r) => ({
        videoId: String(r.video_id),
        label: r.label == null ? null : String(r.label),
        hasThumb: r.has_thumb === true || r.has_thumb === "t",
      }));
    },
    async getVideoThumb(videoId) {
      const rows = await query(`SELECT encode(thumb, 'base64') AS b64, thumb_type FROM "SocialVideo" WHERE video_id = $1 AND thumb IS NOT NULL`, [videoId]);
      if (!rows[0]) return null;
      return { bytes: new Uint8Array(Buffer.from(String(rows[0].b64).replace(/\s+/g, ""), "base64")), type: String(rows[0].thumb_type ?? "image/jpeg") };
    },
  };
}

export function memoryStore(seed: ValidPlaceInput[]): PlaceStore {
  const rows = new Map<string, PlaceRecord>();
  const videos = new Map<string, SocialVideo>();
  const now = () => new Date().toISOString();
  const put = (p: ValidPlaceInput): PlaceRecord => {
    const id = p.id ?? crypto.randomUUID();
    const t = now();
    const { id: _ignored, ...rest } = p;
    void _ignored;
    const rec: PlaceRecord = { ...rest, id, address: p.address ?? null, googlePlaceId: null, enrichedAt: null, enrichment: {}, createdAt: t, updatedAt: t };
    rows.set(id, rec);
    return rec;
  };
  seed.forEach(put);
  return {
    kind: "memory",
    async list() {
      return [...rows.values()];
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async create(p) {
      if (p.id && rows.has(p.id)) throw new Error(`duplicate id ${p.id}`);
      return put(p);
    },
    async update(id, patch) {
      const cur = rows.get(id);
      if (!cur) return null;
      const next: PlaceRecord = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), updatedAt: now() };
      rows.set(id, next);
      return next;
    },
    async remove(id) {
      return rows.delete(id);
    },
    async count() {
      return rows.size;
    },
    async upsertVideo(v) {
      const cur = videos.get(v.videoId);
      videos.set(v.videoId, { ...cur, ...v, label: v.label ?? cur?.label ?? null, thumb: v.thumb ?? cur?.thumb ?? null, thumbType: v.thumbType ?? cur?.thumbType ?? null });
    },
    async listVideos() {
      return [...videos.values()].map((v) => ({ videoId: v.videoId, label: v.label, hasThumb: !!v.thumb }));
    },
    async getVideoThumb(videoId) {
      const v = videos.get(videoId);
      return v?.thumb ? { bytes: v.thumb, type: v.thumbType ?? "image/jpeg" } : null;
    },
  };
}
