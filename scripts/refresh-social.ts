// Refresh the TikTok metadata + thumbnail cache.
//   npm run social:refresh            fetch anything not cached yet
//   npm run social:refresh -- --force re-fetch everything
//
// Why this exists: TikTok cover-image URLs are signed and expire in ~48h, so they cannot be
// hotlinked or stored. We download each cover once, resize it, and host it under
// public/social/ with a content-hashed name (cacheable forever). content/social.json maps
// video id -> thumb path; lib/content.ts merges it into each place's links.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import sharp from "sharp";
import { parseTikTok } from "../lib/social";

const ROOT = process.cwd();
const PLACES = path.join(ROOT, "content/places");
const MANIFEST = path.join(ROOT, "content/social.json");
const OUT_DIR = path.join(ROOT, "public/social");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const force = process.argv.includes("--force");

type Item = { thumb?: string; label?: string; author?: string; durationSec?: number; status: "ok" | "unavailable"; fetchedAt: string };

/** "@author · first words of the caption…" for the dropdown row. */
function labelFor(author: string, desc: string): string {
  let t = desc.replace(/[#@]\S+/g, "").replace(/\s+/g, " ").trim().replace(/^[-–—:|·\s]+|[-–—:|·\s]+$/g, "");
  if (t.length > 56) t = t.slice(0, 56).replace(/\s+\S*$/, "").replace(/[,.;:!-]+$/, "") + "…";
  return t ? `@${author} · ${t}` : `Video by @${author}`;
}
const manifest: { version: 1; items: Record<string, Item> } = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
  : { version: 1, items: {} };

const ids = new Map<string, string>(); // id -> url
// Links from the database (when configured) and from content/places (seed data).
async function addDatabaseLinks() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return;
  const { neon } = await import("@neondatabase/serverless");
  const rows = (await neon(url).query(`SELECT social FROM "Place"`)) as { social: Record<string, string[]> }[];
  for (const r of rows) for (const u of r.social?.tiktok ?? []) {
    const t = parseTikTok(u);
    if (t) ids.set(t.id, u);
  }
}
for (const f of fs.readdirSync(PLACES).filter((f) => f.endsWith(".md"))) {
  const { data } = matter(fs.readFileSync(path.join(PLACES, f), "utf8"));
  for (const l of (data.links ?? []) as { platform: string; url: string }[]) {
    const t = l.platform === "tiktok" ? parseTikTok(l.url) : null;
    if (t) ids.set(t.id, l.url);
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
async function main() {
  await addDatabaseLinks();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let fetched = 0;
  const unavailable: string[] = [];

  for (const [id, url] of ids) {
    if (!force && manifest.items[id]?.thumb && fs.existsSync(path.join(ROOT, "public", manifest.items[id].thumb!))) continue;
    try {
      const page = await (await fetch(url, { headers: { "user-agent": UA } })).text();
      const json = page.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
      const detail = json ? JSON.parse(json).__DEFAULT_SCOPE__?.["webapp.video-detail"] : undefined;
      const item = detail?.itemInfo?.itemStruct;
      if (!item) {
        manifest.items[id] = { status: "unavailable", fetchedAt: new Date().toISOString() };
        unavailable.push(`${id} (${detail?.statusMsg ?? "no data"})`);
        continue;
      }
      const cover: string | undefined = item.video?.originCover || item.video?.cover;
      let thumb: string | undefined;
      if (cover) {
        const buf = Buffer.from(await (await fetch(cover, { headers: { "user-agent": UA } })).arrayBuffer());
        const jpg = await sharp(buf).resize(270, 480, { fit: "cover", position: "attention" }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
        const hash = crypto.createHash("sha1").update(jpg).digest("hex").slice(0, 8);
        const name = `tt-${id}-${hash}.jpg`;
        for (const old of fs.readdirSync(OUT_DIR).filter((n) => n.startsWith(`tt-${id}-`) && n !== name)) fs.unlinkSync(path.join(OUT_DIR, old));
        fs.writeFileSync(path.join(OUT_DIR, name), jpg);
        thumb = `/social/${name}`;
      }
      manifest.items[id] = { thumb, label: labelFor(item.author?.uniqueId ?? "", item.desc ?? ""), author: item.author?.uniqueId, durationSec: item.video?.duration, status: "ok", fetchedAt: new Date().toISOString() };
      fetched++;
    } catch (e) {
      console.warn(`! ${id}: ${(e as Error).message}`);
    }
    await sleep(1000);
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n");
  console.log(`social cache: ${ids.size} videos, ${fetched} fetched, ${unavailable.length} unavailable`);
  if (unavailable.length) console.log("unavailable:\n  " + unavailable.join("\n  "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
