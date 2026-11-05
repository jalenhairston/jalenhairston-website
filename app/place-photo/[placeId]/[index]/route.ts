// Google Places photos. Google's terms do not allow storing photo files or links, so the database keeps
// only the Google place id; each view asks Google for a fresh, short-lived photo URL and redirects to it.
// Needs GOOGLE_PLACES_SERVER_KEY (an API key restricted to the Places API, without a website restriction).

export async function GET(_req: Request, ctx: { params: Promise<{ placeId: string; index: string }> }) {
  const { placeId, index } = await ctx.params;
  const i = Number(index);
  const key = process.env.GOOGLE_PLACES_SERVER_KEY;
  if (!key || !/^[A-Za-z0-9_-]{10,300}$/.test(placeId) || !Number.isInteger(i) || i < 0 || i > 9) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const details = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: { "x-goog-api-key": key, "x-goog-fieldmask": "photos" },
    });
    if (!details.ok) return new Response("Not found", { status: 404 });
    const name = ((await details.json()) as { photos?: { name?: string }[] }).photos?.[i]?.name;
    if (!name) return new Response("Not found", { status: 404 });
    const media = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=960&skipHttpRedirect=true`, {
      headers: { "x-goog-api-key": key },
    });
    if (!media.ok) return new Response("Not found", { status: 404 });
    const { photoUri } = (await media.json()) as { photoUri?: string };
    if (!photoUri?.startsWith("https://")) return new Response("Not found", { status: 404 });
    return new Response(null, { status: 302, headers: { location: photoUri, "cache-control": "public, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
