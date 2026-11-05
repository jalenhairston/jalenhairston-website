// Schema migrations + one-time seed for the "Place" table. Used by scripts/db-migrate.ts (and tests) only;
// kept out of lib/places-store.ts so the app's server bundle never touches the filesystem for migrations.
import fs from "node:fs";
import path from "node:path";
import type { ValidPlaceInput } from "./places-model";
import { pgStore, type Query } from "./places-store";

/** Split a migration file into statements (no semicolons inside strings in our migrations). */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Apply db/migrations/*.sql in order (each once, tracked in _migrations), then seed the table one time
 * ever (also tracked, so deleting places is never undone by a later deploy).
 */
export async function migrate(
  query: Query,
  seedInputs: () => ValidPlaceInput[],
  dir = path.join(process.cwd(), "db/migrations"),
): Promise<{ applied: string[]; seeded: number }> {
  await query(`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await query(`SELECT name FROM _migrations`)).map((r) => String(r.name)));
  const applied: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    for (const stmt of splitStatements(fs.readFileSync(path.join(dir, file), "utf8"))) await query(stmt);
    await query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
    applied.push(file);
  }
  let seeded = 0;
  if (!done.has("seed:initial")) {
    const store = pgStore(query);
    if ((await store.count()) === 0) {
      for (const p of seedInputs()) {
        await store.create(p);
        seeded++;
      }
    }
    await query(`INSERT INTO _migrations (name) VALUES ('seed:initial')`);
  }
  return { applied, seeded };
}
