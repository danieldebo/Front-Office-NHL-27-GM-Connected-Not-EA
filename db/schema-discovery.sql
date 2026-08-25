-- ============================================================================
-- Front Office — discovery, ranking & waitlist schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 1.4.0
-- Phase: 3 (discovery/marketplace phase; needs leagues, seasons, seats)
--
-- Adds:
--   1. League discovery — leagues opt in to the public "open leagues" page
--   2. Self-reported Ranked Division on a player (Bronze..Ultimate)
--   3. A PRIVATE admin skill rating (1-10) the rated user never sees
--   4. League waitlist — a person requests a future seat and waits
--
-- PRIVACY (carries docs/threat-model.md classification):
--   * ranked_division is SELF-REPORTED and player-visible. It's a bracket the
--     player chooses, like a matchmaking rank. Fine to show.
--   * admin_skill_rating is an ADMIN's private assessment of a person. It is
--     never shown to that person, never public, never used to auto-reject them,
--     and never inferred by the platform. It is Internal-class at most and lives
--     ONLY behind admin-scoped endpoints. See §3 and the spec addendum.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('1.4.0', 'Open-league discovery, ranked division, private admin rating, waitlist');

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Self-reported competitive bracket. Ordered low..high. The player picks it.
CREATE TYPE ranked_division AS ENUM
    ('bronze','silver','gold','diamond','platinum','elite','ultimate');

CREATE TYPE waitlist_status AS ENUM ('waiting','invited','placed','declined','withdrawn','expired');

-- ---------------------------------------------------------------------------
-- 1. League discovery
-- ---------------------------------------------------------------------------
-- A league opts in to appear on the public "open leagues" page and describes
-- what it's recruiting for. Discovery is separate from visibility: a league can
-- be publicly viewable without actively recruiting, and vice versa.

CREATE TABLE league_listing (
    league_id          UUID PRIMARY KEY REFERENCES league(id),
    is_listed          BOOLEAN NOT NULL DEFAULT false,
    accepting_signups  BOOLEAN NOT NULL DEFAULT false,
    accepting_waitlist BOOLEAN NOT NULL DEFAULT true,
    blurb              TEXT,                          -- short recruiting pitch
    platform           TEXT,                          -- 'psn' | 'xbox' | 'both'
    -- Optional soft guidance to prospects; NOT an enforced gate.
    suggested_division ranked_division,
    timezone_focus     TEXT,                          -- IANA, for overlap hints
    competitiveness    TEXT,                          -- 'casual' | 'competitive' | 'hardcore'
    listed_at          TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON league_listing (is_listed) WHERE is_listed;

-- ---------------------------------------------------------------------------
-- 2. Self-reported ranked division
-- ---------------------------------------------------------------------------
-- The player's own declared bracket. Player-visible, player-editable. Shown on
-- their sign-up and on the commissioner's roster so a league can gauge fit.

ALTER TABLE app_user
    ADD COLUMN ranked_division ranked_division;

-- A player may also state a division per sign-up (their level can drift, and a
-- league may ask "what were you last season"). Defaults from app_user.
-- (see league_signup below)

-- ---------------------------------------------------------------------------
-- 3. Private admin skill rating  — the user NEVER sees this
-- ---------------------------------------------------------------------------
-- An admin/commissioner's private 1-10 read on how a person actually plays.
-- This exists to help admins build balanced leagues and place waitlisted people
-- sensibly. It is deliberately isolated in its own table (not a column on
-- app_user) so it can NEVER be selected by accident in a user-facing query, and
-- so its access can be locked to admin-scoped code paths and row-level policy.
--
-- Hard boundaries (enforced in code + spec, see docs/discovery-addendum.md §3):
--   * Never returned by any endpoint the rated user can reach.
--   * Never public. Never in the export. Never in the weekly email. Never logged.
--   * Never auto-rejects or auto-ranks a waitlist — it's advisory to a human.
--   * Never inferred by the platform. An admin sets it, or it doesn't exist.

CREATE TABLE admin_skill_rating (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Scope: a rating is given within a league context by an admin of that
    -- league. It is not a global score that follows a person everywhere.
    league_id      UUID NOT NULL REFERENCES league(id),
    subject_user_id UUID NOT NULL REFERENCES app_user(id),
    rating         INT NOT NULL CHECK (rating BETWEEN 1 AND 10),
    note           TEXT,                              -- admin's private note
    rated_by       UUID NOT NULL REFERENCES app_user(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One current rating per subject per league per admin. History via updated_at.
    UNIQUE (league_id, subject_user_id, rated_by)
);
CREATE INDEX ON admin_skill_rating (league_id, subject_user_id);

-- No view exposes this table joined to anything user-facing. That absence is
-- intentional and load-bearing — see the DQ guard below.

-- ---------------------------------------------------------------------------
-- 4. Sign-ups & waitlist
-- ---------------------------------------------------------------------------
-- A sign-up is a person raising their hand for a league found on the open-
-- leagues page. If a seat is open it can convert straight to placement; if not,
-- it becomes a waitlist entry.

CREATE TABLE league_signup (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id          UUID NOT NULL REFERENCES league(id),
    user_id            UUID NOT NULL REFERENCES app_user(id),
    -- What the applicant tells the league about themselves.
    stated_division    ranked_division,
    platform           TEXT,
    timezone           TEXT,                          -- IANA
    message            TEXT,                          -- optional note to the commissioner
    -- Preferred club if the league lets applicants ask.
    preferred_club     TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (league_id, user_id)                       -- one open sign-up per league
);
CREATE INDEX ON league_signup (league_id, created_at);

-- The waitlist proper. Order is by position (a stable queue), not just by time,
-- so a commissioner can move someone up without rewriting timestamps.
CREATE TABLE waitlist_entry (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id      UUID NOT NULL REFERENCES league(id),
    user_id        UUID NOT NULL REFERENCES app_user(id),
    signup_id      UUID REFERENCES league_signup(id),
    status         waitlist_status NOT NULL DEFAULT 'waiting',
    -- Queue position within a league. Sparse integers so reordering is cheap.
    position       INT NOT NULL,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- When invited off the list, the invite expires so the queue keeps moving.
    invited_at     TIMESTAMPTZ,
    invite_expires_at TIMESTAMPTZ,
    resolved_at    TIMESTAMPTZ,
    decline_note   TEXT,
    UNIQUE (league_id, user_id),                      -- one spot per person per league
    UNIQUE (league_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ON waitlist_entry (league_id, position) WHERE status = 'waiting';

-- ---------------------------------------------------------------------------
-- 5. Views
-- ---------------------------------------------------------------------------

-- The public "open leagues" directory. Only listed leagues, with live seat and
-- waitlist counts. NOTE: this view carries NOTHING private — no admin ratings,
-- no member emails. It is safe to serve to a signed-out visitor.
CREATE VIEW v_open_leagues AS
SELECT
    l.id AS league_id,
    l.slug,
    l.name,
    l.logo_url,
    ll.blurb,
    ll.platform,
    ll.competitiveness,
    ll.suggested_division,
    ll.accepting_signups,
    ll.accepting_waitlist,
    s.id AS active_season_id,
    s.max_seats,
    COUNT(ts.id) FILTER (WHERE ts.seat_status = 'filled') AS seats_filled,
    s.max_seats - COUNT(ts.id) FILTER (WHERE ts.seat_status = 'filled') AS seats_open,
    (SELECT COUNT(*) FROM waitlist_entry w
       WHERE w.league_id = l.id AND w.status = 'waiting') AS waitlist_length,
    lh.games_confirmed,
    lh.active_gms
FROM league l
JOIN league_listing ll ON ll.league_id = l.id AND ll.is_listed
LEFT JOIN season s ON s.league_id = l.id AND s.is_active
LEFT JOIN team_season ts ON ts.season_id = s.id
LEFT JOIN v_league_health lh ON lh.season_id = s.id
WHERE l.deleted_at IS NULL
GROUP BY l.id, l.slug, l.name, l.logo_url, ll.blurb, ll.platform,
         ll.competitiveness, ll.suggested_division, ll.accepting_signups,
         ll.accepting_waitlist, s.id, s.max_seats, lh.games_confirmed, lh.active_gms;

-- Commissioner-facing applicant view: sign-ups + waitlist for a league, with the
-- applicant's SELF-REPORTED division. The private admin rating is joined ONLY in
-- an admin-scoped query in code, never here.
CREATE VIEW v_league_applicants AS
SELECT
    su.league_id,
    su.user_id,
    u.display_name,
    su.stated_division,
    su.platform,
    su.timezone,
    su.message,
    su.preferred_club,
    su.created_at,
    w.status AS waitlist_status,
    w.position AS waitlist_position
FROM league_signup su
JOIN app_user u ON u.id = su.user_id
LEFT JOIN waitlist_entry w ON w.signup_id = su.id;

-- ---------------------------------------------------------------------------
-- Data quality guards
-- ---------------------------------------------------------------------------

-- BLOCK: the private rating table must never be referenced by a view whose name
-- suggests public/applicant exposure. This is a static guard the CI PII check
-- also enforces; here it documents the invariant in the DQ layer.
-- (Implemented in code/CI as a schema lint: no view except admin-scoped ones may
--  reference admin_skill_rating. Listed here so the intent is discoverable.)

-- ALERT: a waitlist invite that expired but wasn't resolved — the queue is stuck.
CREATE OR REPLACE VIEW dq.check_stuck_waitlist AS
SELECT id AS waitlist_entry_id, league_id, user_id, invite_expires_at
FROM waitlist_entry
WHERE status = 'invited'
  AND invite_expires_at IS NOT NULL
  AND invite_expires_at < now();

-- ALERT: a placed sign-up still sitting on the waitlist as 'waiting'.
CREATE OR REPLACE VIEW dq.check_signup_waitlist_desync AS
SELECT su.id AS signup_id, su.league_id, su.user_id
FROM league_signup su
JOIN gm_assignment ga ON ga.user_id = su.user_id
JOIN team_season ts ON ts.id = ga.team_season_id AND ts.season_id IN
     (SELECT id FROM season WHERE league_id = su.league_id AND is_active)
JOIN waitlist_entry w ON w.signup_id = su.id
WHERE ga.ended_at IS NULL AND w.status = 'waiting';

-- ---------------------------------------------------------------------------
-- Structural note
-- ---------------------------------------------------------------------------
-- admin_skill_rating is intentionally a standalone table, never a column on a
-- user-facing entity, so that "SELECT * FROM app_user" or any applicant view can
-- never leak it. The only path to it is an admin-scoped endpoint that joins it
-- explicitly. Keep it that way. See docs/discovery-addendum.md §3.
-- ============================================================================
