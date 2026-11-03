// Framework-free helpers for TikTok / Instagram links: parsing, embed URLs, warm-up policy.
// Used by the content loader, the map UI, and scripts/refresh-social.ts.

export type TikTokRef = { user: string; id: string };
export type InstagramRef = { kind: "reel" | "p" | "tv"; code: string };
export type Embed = { platform: "tiktok" | "instagram"; src: string; openUrl: string; title: string };

/** `https://www.tiktok.com/@user/video/123…` → { user, id }. Profiles, tags and place pages return null. */
export function parseTikTok(url: string): TikTokRef | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "www.tiktok.com" && u.hostname !== "tiktok.com") return null;
    const m = u.pathname.match(/^\/@([\w.]+)\/video\/(\d{8,25})\/?$/);
    return m ? { user: m[1], id: m[2] } : null;
  } catch {
    return null;
  }
}

/** `https://www.instagram.com/reel/CODE/` (or /p/, /tv/) → { kind, code }. Profiles return null. */
export function parseInstagram(url: string): InstagramRef | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "www.instagram.com" && u.hostname !== "instagram.com") return null;
    const m = u.pathname.match(/^\/(?:[\w.]+\/)?(reel|reels|p|tv)\/([\w-]{5,20})\/?$/);
    return m ? { kind: m[1] === "reels" ? "reel" : (m[1] as InstagramRef["kind"]), code: m[2] } : null;
  } catch {
    return null;
  }
}

/** The official iframe embed for a post, or null when the link is not a single video/reel. */
export function embedFor(link: { platform: string; url: string }): Embed | null {
  if (link.platform === "tiktok") {
    const t = parseTikTok(link.url);
    return t
      ? { platform: "tiktok", src: `https://www.tiktok.com/embed/v2/${t.id}`, openUrl: link.url, title: `TikTok by @${t.user}` }
      : null;
  }
  if (link.platform === "instagram") {
    const i = parseInstagram(link.url);
    return i
      ? {
          platform: "instagram",
          src: `https://www.instagram.com/${i.kind}/${i.code}/embed/captioned/`,
          openUrl: link.url,
          title: "Instagram post",
        }
      : null;
  }
  return null;
}

type Connection = { saveData?: boolean; effectiveType?: string } | undefined;

/** Background warm-up is a courtesy: skip it on Save-Data and 2G connections. */
export function canWarm(connection: Connection): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/^(slow-)?2g$/.test(connection.effectiveType ?? "");
}
