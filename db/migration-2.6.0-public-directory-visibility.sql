-- Make the database-owned public discovery projection enforce league privacy.
BEGIN;

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
  AND l.visibility = 'public'
GROUP BY l.id, l.slug, l.name, l.logo_url, ll.blurb, ll.platform,
         ll.competitiveness, ll.suggested_division, ll.accepting_signups,
         ll.accepting_waitlist, s.id, s.max_seats, lh.games_confirmed, lh.active_gms;

INSERT INTO schema_version (version, notes)
VALUES ('2.6.0', 'Restrict the public open-leagues projection to public visibility')
ON CONFLICT (version) DO NOTHING;

COMMIT;