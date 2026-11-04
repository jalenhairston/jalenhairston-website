"use server";
// Writes to the shared place list. Every action checks the edit code first: server actions are plain POST
// endpoints anyone can call, so the code (PLACES_EDIT_CODE, set in Vercel) is what keeps strangers out.
import crypto from "node:crypto";
import { updateTag } from "next/cache";
import { placeInputSchema, toMapPlace, type MapPlace } from "@/lib/places-model";
import { getStore } from "@/lib/places-db";
import { PLACES_TAG } from "@/lib/places-data";
import manifest from "@/content/social.json";

type Fail = { ok: false; reason: "auth" | "invalid" | "full" | "server"; error: string };
const MAX_PLACES = 2000;

function codeError(code: unknown): Fail | null {
  const expected = process.env.PLACES_EDIT_CODE;
  if (!expected) return { ok: false, reason: "auth", error: "Editing isn't set up on this site yet (PLACES_EDIT_CODE is missing)." };
  const a = crypto.createHash("sha256").update(String(code ?? "")).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b) ? null : { ok: false, reason: "auth", error: "That edit code isn't right." };
}

export async function checkEditCode(code: string): Promise<{ ok: true } | Fail> {
  return codeError(code) ?? { ok: true };
}

export async function createPlace(code: string, input: unknown): Promise<{ ok: true; place: MapPlace } | Fail> {
  const denied = codeError(code);
  if (denied) return denied;
  const parsed = placeInputSchema.omit({ id: true }).safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", error: parsed.error.issues.map((i) => `${i.path.join(".") || "place"}: ${i.message}`).join("; ") };
  try {
    const store = getStore();
    if ((await store.count()) >= MAX_PLACES) return { ok: false, reason: "full", error: "The map is full." };
    const rec = await store.create(parsed.data);
    updateTag(PLACES_TAG);
    return { ok: true, place: toMapPlace(rec, manifest) };
  } catch (e) {
    console.error("createPlace failed", e);
    return { ok: false, reason: "server", error: "Couldn't save right now. Try again in a moment." };
  }
}

/** Move places that were saved only in one browser (before the database) into the shared list. */
export async function importPlaces(code: string, inputs: unknown[]): Promise<{ ok: true; places: MapPlace[]; skipped: number } | Fail> {
  const denied = codeError(code);
  if (denied) return denied;
  if (!Array.isArray(inputs) || inputs.length > 100) return { ok: false, reason: "invalid", error: "Nothing to import." };
  const store = getStore();
  const places: MapPlace[] = [];
  let skipped = 0;
  try {
    for (const raw of inputs) {
      const parsed = placeInputSchema.omit({ id: true }).safeParse(raw);
      if (!parsed.success) {
        skipped++;
        continue;
      }
      places.push(toMapPlace(await store.create(parsed.data), manifest));
    }
  } catch (e) {
    console.error("importPlaces failed", e);
    return { ok: false, reason: "server", error: "Couldn't move your places right now. Try again in a moment." };
  } finally {
    if (places.length) updateTag(PLACES_TAG);
  }
  return { ok: true, places, skipped };
}

export async function deletePlace(code: string, id: string): Promise<{ ok: true } | Fail> {
  const denied = codeError(code);
  if (denied) return denied;
  if (typeof id !== "string" || id.length > 100) return { ok: false, reason: "invalid", error: "Unknown place." };
  try {
    await getStore().remove(id);
    updateTag(PLACES_TAG);
    return { ok: true };
  } catch (e) {
    console.error("deletePlace failed", e);
    return { ok: false, reason: "server", error: "Couldn't remove it right now. Try again in a moment." };
  }
}
