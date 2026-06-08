-- User favorite transit stops
CREATE TABLE IF NOT EXISTS user_transit_stops (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stop_id      text NOT NULL,        -- NSR:StopPlace:XXXXX
  stop_name    text NOT NULL,
  stop_locality text,               -- city/municipality e.g. "Oslo"
  label        text,                -- user's custom name e.g. "Home stop"
  is_default   boolean NOT NULL DEFAULT false,
  sort_order   int     NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE user_transit_stops ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_transit_stops' AND policyname = 'transit_stops_owner'
  ) THEN
    CREATE POLICY transit_stops_owner ON user_transit_stops
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS user_transit_stops_unique ON user_transit_stops (user_id, stop_id);
CREATE INDEX  IF NOT EXISTS user_transit_stops_user   ON user_transit_stops (user_id, sort_order);

-- User favorite transit routes (point-to-point presets)
CREATE TABLE IF NOT EXISTS user_transit_routes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label          text NOT NULL,          -- user's label e.g. "Home", "Work"
  from_stop_id   text NOT NULL,          -- NSR:StopPlace:XXXXX
  from_stop_name text NOT NULL,
  to_stop_id     text NOT NULL,
  to_stop_name   text NOT NULL,
  sort_order     int  NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE user_transit_routes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_transit_routes' AND policyname = 'transit_routes_owner'
  ) THEN
    CREATE POLICY transit_routes_owner ON user_transit_routes
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS user_transit_routes_user ON user_transit_routes (user_id, sort_order);
