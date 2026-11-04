"use server";
// Writes to the shared place list. Every action checks the edit code first: server actions are plain POST
// endpoints anyone can call, so the code (PLACES_EDIT_CODE, set in Vercel) is what keeps strangers out.
import { revalidateTag, updateTag } from "next/cache";
import { after } from "next/server";
import { placeInputSchema, type MapPlace } from "@/lib/places-model";
import { getStore } from "@/lib/places-db";
import { PLACES_TAG } from "@/lib/places-data";
import { toMapPlaces } from "@/lib/places-view";
import { runEnrichment } from "@/lib/enrich-runner";
import { editCodeProblem } from "@/lib/edit-code";

/** After a response is sent: look up photos and TikToks for new places, then expire the cached list. */
function enrichInBackground(ids: string[]) {
  after(async () => {
    for (const id of ids) {
      try {
        await runEnrichment(id, () => revalidateTag(PLACES_TAG, { expire: 0 }));
      } catch (e) {
        console.error(`enrichment failed for ${id}`, e);
      }
    }
  });
}

async function view(rec: Parameters<typeof toMapPlaces>[1][number]): Promise<MapPlace> {
  return (await toMapPlaces(getStore(), [rec]))[0];
}

type Fail = { ok: false; reason: "auth" | "invalid" | "full" | "server"; error: string };
const MAX_PLACES = 2000;

function codeError(code: unknown): Fail | null {
  const problem = editCodeProblem(code);
  return problem ? { ok: false, reason: "auth", error: problem } : null;
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
    enrichInBackground([rec.id]);
    return { ok: true, place: await view(rec) };
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
      places.push(await view(await store.create(parsed.data)));
    }
  } catch (e) {
    console.error("importPlaces failed", e);
    return { ok: false, reason: "server", error: "Couldn't move your places right now. Try again in a moment." };
  } finally {
    if (places.length) {
      updateTag(PLACES_TAG);
      enrichInBackground(places.map((p) => p.id));
    }
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

/** Read-only: the current state of one place (the card polls this while the pipeline runs). */
export async function getPlaceStatus(id: string): Promise<MapPlace | null> {
  if (typeof id !== "string" || id.length > 100) return null;
  const rec = await getStore().get(id);
  return rec ? view(rec) : null;
}

/** Run the pipeline now for one place (the card's "Find photos & TikToks" button). */
export async function enrichNow(code: string, id: string): Promise<{ ok: true; place: MapPlace } | Fail> {
  const denied = codeError(code);
  if (denied) return denied;
  if (typeof id !== "string" || id.length > 100) return { ok: false, reason: "invalid", error: "Unknown place." };
  try {
    const rec = await runEnrichment(id, () => updateTag(PLACES_TAG));
    if (!rec) return { ok: false, reason: "invalid", error: "That place no longer exists." };
    return { ok: true, place: await view(rec) };
  } catch (e) {
    console.error("enrichNow failed", e);
    return { ok: false, reason: "server", error: "Couldn't look anything up right now. Try again in a moment." };
  }
}
