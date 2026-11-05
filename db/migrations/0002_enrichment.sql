-- Enrichment pipeline: what was looked up for each place, and cached TikTok video details.
ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS google_place_id text;
ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
-- e.g. {"photos": "commons", "tiktok": 2, "notes": ["no TikTok search key"]}
ALTER TABLE "Place" ADD COLUMN IF NOT EXISTS enrichment jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One row per TikTok video we have looked at: caption label + a small cover thumbnail (TikTok's own
-- cover URLs expire after ~48h, so the image bytes are kept here and served from /social-thumb/<id>).
CREATE TABLE IF NOT EXISTS "SocialVideo" (
  video_id   text PRIMARY KEY,
  url        text NOT NULL,
  label      text,
  thumb      bytea,
  thumb_type text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
