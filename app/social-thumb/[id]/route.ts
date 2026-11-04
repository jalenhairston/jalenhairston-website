// TikTok cover thumbnails saved by the enrichment pipeline (TikTok's own cover URLs expire in ~48h).
import { getStore } from "@/lib/places-db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{8,25}$/.test(id)) return new Response("Not found", { status: 404 });
  const thumb = await getStore().getVideoThumb(id);
  if (!thumb) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(thumb.bytes), {
    headers: { "content-type": thumb.type, "cache-control": "public, max-age=604800, immutable" },
  });
}
