-- Places shown on /map. One row per spot.
-- social: platform -> list of links, e.g. {"tiktok": ["https://www.tiktok.com/@u/video/1"], "instagram": []}
-- photos: [{"src": "https://…", "alt": "…", "credit": "…", "creditUrl": "https://…"}]
CREATE TABLE IF NOT EXISTS "Place" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  address     text CHECK (address IS NULL OR char_length(address) <= 300),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  social      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(social) = 'object'),
  latitude    double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  city        text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT 'other',
  photos      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(photos) = 'array'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS place_created_at_idx ON "Place" (created_at);
