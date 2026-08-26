-- Immutable league settings versions (Task 60). Depends on the base and
-- membership schemas. All DDL/backfill operations are safe to replay.
BEGIN;
CREATE SCHEMA IF NOT EXISTS dq;

INSERT INTO schema_version (version, notes)
VALUES ('2.0.0', 'Immutable versioned league operational settings')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS league_settings_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES league(id),
    version INT NOT NULL CHECK (version > 0),
    ea_league_id TEXT,
    platform TEXT NOT NULL DEFAULT 'both' CHECK (platform IN ('psn','xbox','both')),
    team_count INT NOT NULL DEFAULT 32 CHECK (team_count BETWEEN 3 AND 32),
    roster_source TEXT NOT NULL DEFAULT 'manual' CHECK (roster_source IN ('manual','ea','csv_import')),
    schedule_format TEXT NOT NULL DEFAULT 'round_robin'
      CHECK (schedule_format IN ('round_robin','double_round_robin','custom')),
    schedule_settings JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(schedule_settings) = 'object'),
    playoff_format JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(playoff_format) = 'object'),
    salary_cap_cents BIGINT CHECK (salary_cap_cents IS NULL OR salary_cap_cents >= 0),
    roster_min INT CHECK (roster_min IS NULL OR roster_min >= 1),
    roster_max INT CHECK (roster_max IS NULL OR roster_max >= 1),
    divisions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(divisions) = 'array'),
    conferences JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conferences) = 'array'),
    rules_notes TEXT,
    slider_presets JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(slider_presets) = 'object'),
    migrated_from_season_id UUID UNIQUE REFERENCES season(id),
    changed_by UUID NOT NULL REFERENCES app_user(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    change_summary TEXT NOT NULL CHECK (length(btrim(change_summary)) > 0),
    UNIQUE (league_id, version),
    UNIQUE (league_id, id),
    CHECK (roster_min IS NULL OR roster_max IS NULL OR roster_min <= roster_max),
    CHECK (schedule_format <> 'custom' OR
      (schedule_settings ? 'games_per_matchup'
       AND jsonb_typeof(schedule_settings->'games_per_matchup') = 'number'
       AND (schedule_settings->>'games_per_matchup')::INT BETWEEN 1 AND 8))
);

CREATE TABLE IF NOT EXISTS league_settings_active (
    league_id UUID PRIMARY KEY REFERENCES league(id) ON DELETE CASCADE,
    settings_version_id UUID NOT NULL UNIQUE,
    FOREIGN KEY (league_id, settings_version_id)
      REFERENCES league_settings_version(league_id, id)
);

CREATE OR REPLACE FUNCTION reject_league_settings_version_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'league_settings_version is append-only';
END;
$$;
DROP TRIGGER IF EXISTS league_settings_version_append_only ON league_settings_version;
CREATE TRIGGER league_settings_version_append_only
BEFORE UPDATE OR DELETE ON league_settings_version
FOR EACH ROW EXECUTE FUNCTION reject_league_settings_version_mutation();

ALTER TABLE league_settings_version
  ADD COLUMN IF NOT EXISTS migrated_from_season_id UUID REFERENCES season(id);
CREATE UNIQUE INDEX IF NOT EXISTS league_settings_version_migrated_season_uq
  ON league_settings_version (migrated_from_season_id);

ALTER TABLE season ADD COLUMN IF NOT EXISTS settings_version_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'season_settings_version_same_league'
  ) THEN
    ALTER TABLE season
      ADD CONSTRAINT season_settings_version_same_league
      FOREIGN KEY (league_id, settings_version_id)
      REFERENCES league_settings_version(league_id, id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM season
     WHERE games_per_matchup NOT BETWEEN 1 AND 8
        OR max_seats NOT BETWEEN 3 AND 32
  ) THEN
    RAISE EXCEPTION
      'legacy season settings cannot be represented: games_per_matchup must be 1-8 and max_seats must be 3-32';
  END IF;
END;
$$;

-- Preserve each pre-settings season independently. On a replay after the
-- original migration, created_at identifies seasons that predate the league's
-- first settings row while leaving newly-created, correctly-bound seasons alone.
WITH earliest AS (
  SELECT league_id, MIN(changed_at) AS first_settings_at
    FROM league_settings_version
   GROUP BY league_id
),
legacy AS (
  SELECT s.*,
         COALESCE((
           SELECT MAX(v.version) FROM league_settings_version v
            WHERE v.league_id = s.league_id
         ), 0)
         + ROW_NUMBER() OVER (PARTITION BY s.league_id ORDER BY s.ordinal, s.id) AS next_version
    FROM season s
    LEFT JOIN earliest e ON e.league_id = s.league_id
   WHERE NOT EXISTS (
     SELECT 1 FROM league_settings_version v
      WHERE v.migrated_from_season_id = s.id
   )
     AND (e.first_settings_at IS NULL OR s.created_at <= e.first_settings_at)
)
INSERT INTO league_settings_version (
  league_id, version, team_count, schedule_format, schedule_settings,
  salary_cap_cents, roster_min, roster_max, migrated_from_season_id,
  changed_by, change_summary
)
SELECT s.league_id, s.next_version,
       s.max_seats,
       CASE s.games_per_matchup
         WHEN 1 THEN 'round_robin'
         WHEN 2 THEN 'double_round_robin'
         ELSE 'custom'
       END,
       CASE WHEN s.games_per_matchup IN (1, 2) THEN '{}'::jsonb
            ELSE jsonb_build_object('games_per_matchup', s.games_per_matchup)
       END,
       s.salary_cap_cents, s.roster_min, s.roster_max, s.id,
       l.owner_user_id, 'Initial settings migrated for ' || s.label
  FROM legacy s
  JOIN league l ON l.id = s.league_id
ON CONFLICT (migrated_from_season_id) DO NOTHING;

UPDATE season s
   SET settings_version_id = v.id
  FROM league_settings_version v
 WHERE v.migrated_from_season_id = s.id
   AND s.settings_version_id IS DISTINCT FROM v.id;

-- Create a separate active snapshot only where one does not already exist.
-- It is used for future seasons and starts from the latest historical season.
WITH candidates AS (
  SELECT l.id AS league_id, l.owner_user_id
    FROM league l
    LEFT JOIN league_settings_active a ON a.league_id = l.id
    LEFT JOIN league_settings_version current ON current.id = a.settings_version_id
   WHERE a.league_id IS NULL
      OR (
        current.migrated_from_season_id IS NULL
        AND current.change_summary = 'Initial settings migrated from existing league data'
      )
),
latest AS (
  SELECT DISTINCT ON (l.league_id)
         l.league_id, l.owner_user_id,
         v.platform, v.team_count, v.roster_source, v.schedule_format,
         v.schedule_settings, v.playoff_format, v.salary_cap_cents,
         v.roster_min, v.roster_max, v.divisions, v.conferences,
         v.slider_presets
    FROM candidates l
    LEFT JOIN season s ON s.league_id = l.league_id
    LEFT JOIN league_settings_version v ON v.migrated_from_season_id = s.id
   ORDER BY l.league_id, s.is_active DESC NULLS LAST, s.ordinal DESC NULLS LAST
),
inserted AS (
  INSERT INTO league_settings_version (
    league_id, version, platform, team_count, roster_source,
    schedule_format, schedule_settings, playoff_format, salary_cap_cents,
    roster_min, roster_max, divisions, conferences, slider_presets,
    changed_by, change_summary
  )
  SELECT x.league_id,
         COALESCE((SELECT MAX(v2.version) FROM league_settings_version v2
                   WHERE v2.league_id = x.league_id), 0) + 1,
         COALESCE(x.platform, 'both'), COALESCE(x.team_count, 32),
         COALESCE(x.roster_source, 'manual'),
         COALESCE(x.schedule_format, 'round_robin'),
         COALESCE(x.schedule_settings, '{}'::jsonb),
         COALESCE(x.playoff_format, '{}'::jsonb),
         x.salary_cap_cents, x.roster_min, x.roster_max,
         COALESCE(x.divisions, '[]'::jsonb),
         COALESCE(x.conferences, '[]'::jsonb),
         COALESCE(x.slider_presets, '{}'::jsonb),
         x.owner_user_id, 'Initial active settings for future seasons'
    FROM latest x
  RETURNING id, league_id
)
INSERT INTO league_settings_active (league_id, settings_version_id)
SELECT league_id, id FROM inserted
ON CONFLICT (league_id) DO UPDATE
SET settings_version_id = EXCLUDED.settings_version_id;

-- Abort rather than silently rewriting historical operational rules.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM season s
      JOIN league_settings_version v ON v.migrated_from_season_id = s.id
     WHERE v.salary_cap_cents IS DISTINCT FROM s.salary_cap_cents
        OR v.roster_min IS DISTINCT FROM s.roster_min
        OR v.roster_max IS DISTINCT FROM s.roster_max
        OR CASE v.schedule_format
             WHEN 'round_robin' THEN 1
             WHEN 'double_round_robin' THEN 2
             ELSE (v.schedule_settings->>'games_per_matchup')::INT
           END IS DISTINCT FROM s.games_per_matchup
        OR v.team_count IS DISTINCT FROM s.max_seats
  ) THEN
    RAISE EXCEPTION 'league settings backfill did not preserve legacy season rules';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_seat_limit() RETURNS TRIGGER AS $$
DECLARE current_seats INT; limit_seats INT;
BEGIN
  SELECT COALESCE(v.team_count, s.max_seats) INTO limit_seats
  FROM season s
  LEFT JOIN league_settings_version v ON v.id = s.settings_version_id
  WHERE s.id = NEW.season_id;
  SELECT COUNT(*) INTO current_seats FROM team_season WHERE season_id = NEW.season_id;
  IF current_seats >= limit_seats THEN
    RAISE EXCEPTION 'season % is full: % of % seats used', NEW.season_id, current_seats, limit_seats
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW dq.check_seat_limit AS
SELECT s.id AS season_id, COALESCE(v.team_count, s.max_seats) AS max_seats,
       COUNT(ts.id) AS seats_used
FROM season s
JOIN team_season ts ON ts.season_id = s.id
LEFT JOIN league_settings_version v ON v.id = s.settings_version_id
GROUP BY s.id, s.max_seats, v.team_count
HAVING COUNT(ts.id) > COALESCE(v.team_count, s.max_seats);

COMMIT;