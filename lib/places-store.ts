// Storage for places. `pgStore` runs on any Postgres reachable through a `query(text, params)` function
// (Neon's HTTP driver in production, PGlite in tests). `memoryStore` is the no-database fallback used in
// local development and end-to-end tests. Framework-free.
import type { PlaceRecord, ValidPlaceInput } from "./places-model";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export interface PlaceStore {
  kind: "database" | "memory";
  list(): Promise<PlaceRecord[]>;
  create(input: ValidPlaceInput): Promise<PlaceRecord>;
  remove(id: string): Promise<boolean>;
  count(): Promise<number>;
}

const COLS = "id, name, address, description, social, latitude, longitude, city, category, photos, created_at, updated_at";

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
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function pgStore(query: Query): PlaceStore {
  return {
    kind: "database",
    async list() {
      return (await query(`SELECT ${COLS} FROM "Place" ORDER BY created_at, id`)).map(toRecord);
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
    async remove(id) {
      return (await query(`DELETE FROM "Place" WHERE id = $1 RETURNING id`, [id])).length > 0;
    },
    async count() {
      return Number((await query(`SELECT count(*)::int AS n FROM "Place"`))[0].n);
    },
  };
}

export function memoryStore(seed: ValidPlaceInput[]): PlaceStore {
  const rows = new Map<string, PlaceRecord>();
  const now = () => new Date().toISOString();
  const put = (p: ValidPlaceInput) => {
    const id = p.id ?? crypto.randomUUID();
    const t = now();
    const rec: PlaceRecord = { ...p, id, address: p.address ?? null, createdAt: t, updatedAt: t };
    delete (rec as Partial<ValidPlaceInput>).id;
    rec.id = id;
    rows.set(id, rec);
    return rec;
  };
  seed.forEach(put);
  return {
    kind: "memory",
    async list() {
      return [...rows.values()];
    },
    async create(p) {
      if (p.id && rows.has(p.id)) throw new Error(`duplicate id ${p.id}`);
      return put(p);
    },
    async remove(id) {
      return rows.delete(id);
    },
    async count() {
      return rows.size;
    },
  };
}
