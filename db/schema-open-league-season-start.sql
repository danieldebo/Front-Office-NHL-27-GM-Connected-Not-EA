-- ============================================================================
-- Front Office — season start date on the public Open Leagues card
-- Target: PostgreSQL 15+  |  Depends on: schema-discovery.sql (>= 1.4.0)
-- Schema version: 2.18.0
--
-- Prospects browsing /leagues/open currently can't tell when a league's
-- season actually starts. season.starts_on already exists (schema.sql); this
-- just surfaces it through v_open_leagues alongside the season it already
-- joins in for max_seats/seats_open.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.18.0', 'v_open_leagues.season_starts_on — active season start date, for the public Open Leagues card');

CREATE OR REPLACE VIEW v_open_leagues AS
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
    s.starts_on AS season_starts_on,
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
         ll.accepting_waitlist, s.id, s.starts_on, s.max_seats, lh.games_confirmed, lh.active_gms;
