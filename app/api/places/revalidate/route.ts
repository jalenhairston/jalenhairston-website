// Lets scripts (e.g. `npm run places:enrich -- --site <url>`) refresh the cached place list after
// writing to the database directly. Requires the edit code in the x-edit-code header.
import { revalidateTag } from "next/cache";
import { editCodeProblem } from "@/lib/edit-code";
import { PLACES_TAG } from "@/lib/places-data";

export async function POST(req: Request) {
  const problem = editCodeProblem(req.headers.get("x-edit-code"));
  if (problem) return Response.json({ ok: false, error: problem }, { status: 401 });
  revalidateTag(PLACES_TAG, { expire: 0 });
  return Response.json({ ok: true });
}
