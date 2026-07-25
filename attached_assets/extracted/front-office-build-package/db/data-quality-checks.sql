-- ============================================================================
-- Front Office — data quality assertion suite
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.0)
--
-- Run after every ingest batch and on a nightly schedule.
-- Each check returns zero rows when healthy. Any returned row is a finding.
--
-- Severity conventions:
--   BLOCK  — refuse to publish the batch; data is not trustworthy
--   ALERT  — notify the commissioner; usually league behavior, not a bug
--   WATCH  — trend indicator, no action required
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS dq;

CREATE TABLE IF NOT EXISTS dq.finding (
    id           BIGSERIAL PRIMARY KEY,
    checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    check_name   TEXT NOT NULL,
    severity     TEXT NOT NULL CHECK (severity IN ('BLOCK','ALERT','WATCH')),
    league_id    UUID,
    season_id    UUID,
    entity_id    UUID,
    detail       TEXT NOT NULL,
    resolved_at  TIMESTAMPTZ,
    resolved_by  UUID
);
CREATE INDEX IF NOT EXISTS finding_open_idx
    ON dq.finding (severity, checked_at DESC) WHERE resolved_at IS NULL;


-- ============================================================================
-- SECTION 1 — INTEGRITY (BLOCK)
-- Violations mean the model is broken, not that a league misbehaved.
-- ============================================================================

-- 1.1 Exactly one active result per completed game.
--     Zero means standings silently undercount. Two means supersede logic broke.
CREATE OR REPLACE VIEW dq.check_result_cardinality AS
SELECT g.season_id, g.id AS game_id, COUNT(r.id) AS active_results
FROM game g
LEFT JOIN game_result r ON r.game_id = g.id AND r.superseded_by IS NULL
WHERE g.status IN ('confirmed','forfeited','simulated')
GROUP BY g.season_id, g.id
HAVING COUNT(r.id) <> 1;

-- 1.2 No supersede cycles or self-references.
CREATE OR REPLACE VIEW dq.check_supersede_integrity AS
SELECT id AS game_result_id, superseded_by, 'self-reference' AS problem
FROM game_result WHERE superseded_by = id
UNION ALL
SELECT a.id, a.superseded_by, 'two-cycle'
FROM game_result a
JOIN game_result b ON a.superseded_by = b.id AND b.superseded_by = a.id;

-- 1.3 A team never plays itself, and windows are well-formed.
--     Also enforced by CHECK constraints; verified here to catch bad backfills.
CREATE OR REPLACE VIEW dq.check_game_sanity AS
SELECT id AS game_id, season_id, 'team faces itself' AS problem
FROM game WHERE home_team_season_id = away_team_season_id
UNION ALL
SELECT id, season_id, 'window closes before it opens'
FROM game WHERE window_closes_at <= window_opens_at;

-- 1.4 Stat rows must belong to a team that actually played that game.
CREATE OR REPLACE VIEW dq.check_stat_team_alignment AS
SELECT s.id AS stat_id, g.id AS game_id, s.team_season_id, 'skater' AS stat_type
FROM skater_game_stat s
JOIN game_result r ON r.id = s.game_result_id
JOIN game g ON g.id = r.game_id
WHERE s.team_season_id NOT IN (g.home_team_season_id, g.away_team_season_id)
UNION ALL
SELECT s.id, g.id, s.team_season_id, 'goalie'
FROM goalie_game_stat s
JOIN game_result r ON r.id = s.game_result_id
JOIN game g ON g.id = r.game_id
WHERE s.team_season_id NOT IN (g.home_team_season_id, g.away_team_season_id);

-- 1.5 Every team_season has at most one active GM.
CREATE OR REPLACE VIEW dq.check_gm_uniqueness AS
SELECT team_season_id, COUNT(*) AS active_gms
FROM gm_assignment
WHERE ended_at IS NULL
GROUP BY team_season_id
HAVING COUNT(*) > 1;

-- 1.6 Trade assets must move between two distinct teams.
CREATE OR REPLACE VIEW dq.check_transaction_assets AS
SELECT a.id AS asset_id, a.transaction_id, 'asset goes nowhere' AS problem
FROM transaction_asset a
JOIN transaction_event t ON t.id = a.transaction_id
WHERE t.txn_type = 'trade'
  AND (a.from_team_season_id IS NULL OR a.to_team_season_id IS NULL
       OR a.from_team_season_id = a.to_team_season_id);


-- ============================================================================
-- SECTION 2 — BUSINESS INVARIANTS (BLOCK)
-- Arithmetic that must hold no matter what any human entered.
-- These are the SQL twins of the property-based tests on /core.
-- ============================================================================

-- 2.1 GP = W + L + OTL, and PTS matches the season's configured point system.
CREATE OR REPLACE VIEW dq.check_standings_arithmetic AS
SELECT st.season_id, st.team_season_id, st.gp, st.w, st.l, st.otl, st.points,
       (st.w * s.points_win + st.otl * s.points_ot_loss + st.l * s.points_reg_loss) AS expected_points
FROM v_standings st
JOIN season s ON s.id = st.season_id
WHERE st.gp <> (st.w + st.l + st.otl)
   OR st.points <> (st.w * s.points_win + st.otl * s.points_ot_loss + st.l * s.points_reg_loss);

-- 2.2 League-wide, goals for must equal goals against. Any gap means a result
--     is being counted for one team and not the other.
CREATE OR REPLACE VIEW dq.check_league_goal_balance AS
SELECT season_id, SUM(gf) AS total_gf, SUM(ga) AS total_ga, SUM(gf) - SUM(ga) AS imbalance
FROM v_standings
GROUP BY season_id
HAVING SUM(gf) <> SUM(ga);

-- 2.3 A regulation decision cannot be a tie; OT/SO cannot be a blowout tie either.
CREATE OR REPLACE VIEW dq.check_decision_consistency AS
SELECT r.id AS result_id, g.season_id, r.home_goals, r.away_goals, r.decision
FROM game_result r
JOIN game g ON g.id = r.game_id
WHERE r.superseded_by IS NULL
  AND (r.home_goals = r.away_goals
       OR (r.decision <> 'regulation' AND ABS(r.home_goals - r.away_goals) <> 1));

-- 2.4 Goalie saves must reconcile: SA = SV + GA.
CREATE OR REPLACE VIEW dq.check_goalie_arithmetic AS
SELECT id AS goalie_stat_id, game_result_id, player_id, shots_against, saves, goals_against
FROM goalie_game_stat
WHERE shots_against <> saves + goals_against;

-- 2.5 Team goals in the box score must match the final score.
CREATE OR REPLACE VIEW dq.check_boxscore_reconciles AS
WITH scored AS (
    SELECT s.game_result_id, s.team_season_id, SUM(s.goals) AS box_goals
    FROM skater_game_stat s GROUP BY 1,2
)
SELECT sc.game_result_id, sc.team_season_id, sc.box_goals,
       CASE WHEN sc.team_season_id = g.home_team_season_id THEN r.home_goals ELSE r.away_goals END AS final_goals
FROM scored sc
JOIN game_result r ON r.id = sc.game_result_id
JOIN game g ON g.id = r.game_id
WHERE r.superseded_by IS NULL
  AND sc.box_goals <> CASE WHEN sc.team_season_id = g.home_team_season_id THEN r.home_goals ELSE r.away_goals END;

-- 2.6 Assists cannot exceed two per goal on a team-game.
CREATE OR REPLACE VIEW dq.check_assist_ceiling AS
SELECT game_result_id, team_season_id, SUM(goals) AS goals, SUM(assists) AS assists
FROM skater_game_stat
GROUP BY 1,2
HAVING SUM(assists) > SUM(goals) * 2;


-- ============================================================================
-- SECTION 3 — PROVENANCE (BLOCK / ALERT)
-- The trust layer. If provenance is wrong, nothing downstream can be defended.
-- ============================================================================

-- 3.1 BLOCK: machine-sourced rows must reference the batch that produced them.
CREATE OR REPLACE VIEW dq.check_provenance_completeness AS
SELECT id AS result_id, data_source, 'missing ingest_batch_id' AS problem
FROM game_result
WHERE data_source IN ('ocr','csv_import','partner_api') AND ingest_batch_id IS NULL
UNION ALL
SELECT id, data_source, 'missing confidence on parsed row'
FROM game_result
WHERE data_source = 'ocr' AND confidence IS NULL;

-- 3.2 BLOCK: parsed data must never count toward standings unconfirmed.
--     This is the guardrail behind ADR 15 — trust over convenience.
CREATE OR REPLACE VIEW dq.check_unconfirmed_ocr_counted AS
SELECT r.id AS result_id, g.season_id, r.confidence
FROM game_result r
JOIN game g ON g.id = r.game_id
WHERE r.superseded_by IS NULL
  AND r.data_source = 'ocr'
  AND r.verified_by IS NULL
  AND g.status = 'confirmed';

-- 3.3 BLOCK: a lower-authority source must never supersede a higher one.
CREATE OR REPLACE VIEW dq.check_authority_inversion AS
SELECT old.id AS superseded_id, new.id AS superseding_id,
       old.data_source AS old_source, new.data_source AS new_source
FROM game_result old
JOIN game_result new ON old.superseded_by = new.id
JOIN data_source_authority ao ON ao.source = old.data_source
JOIN data_source_authority an ON an.source = new.data_source
WHERE an.rank < ao.rank;

-- 3.4 BLOCK: every supersede must state a reason. Silent edits are the exact
--     failure mode this platform exists to eliminate.
CREATE OR REPLACE VIEW dq.check_supersede_reason AS
SELECT old.id AS superseded_id, old.created_at
FROM game_result old
WHERE old.superseded_by IS NOT NULL
  AND (old.supersede_reason IS NULL OR btrim(old.supersede_reason) = '');

-- 3.5 ALERT: a self-confirmed result — reported and verified by the same person.
CREATE OR REPLACE VIEW dq.check_self_confirmation AS
SELECT r.id AS result_id, g.season_id, r.reported_by
FROM game_result r
JOIN game g ON g.id = r.game_id
WHERE r.superseded_by IS NULL
  AND r.data_source = 'confirmed'
  AND r.reported_by = r.verified_by;

-- 3.6 ALERT: an ingest batch that produced conflicts and was never reviewed.
CREATE OR REPLACE VIEW dq.check_unreviewed_conflicts AS
SELECT id AS batch_id, league_id, source, conflict_count, started_at
FROM ingest_batch
WHERE COALESCE(conflict_count,0) > 0
  AND completed_at IS NULL
  AND started_at < now() - INTERVAL '24 hours';


-- ============================================================================
-- SECTION 4 — ROSTER AND CAP LEGALITY (ALERT)
-- League behavior, not system failure. Route to the commissioner.
-- ============================================================================

-- 4.1 Teams currently over the cap or outside roster bounds.
CREATE OR REPLACE VIEW dq.check_cap_legality AS
SELECT team_season_id, cap_used_cents, salary_cap_cents, roster_count
FROM v_cap_position
WHERE is_illegal;

-- 4.2 A player under two active contracts in the same season.
CREATE OR REPLACE VIEW dq.check_duplicate_contracts AS
SELECT season_id, player_id, COUNT(*) AS active_contracts
FROM contract
WHERE superseded_by IS NULL AND team_season_id IS NOT NULL
GROUP BY 1,2
HAVING COUNT(*) > 1;

-- 4.3 A player recorded playing for a team he was not under contract to.
CREATE OR REPLACE VIEW dq.check_ineligible_player AS
SELECT s.id AS stat_id, s.player_id, s.team_season_id, r.game_id
FROM skater_game_stat s
JOIN game_result r ON r.id = s.game_result_id
LEFT JOIN contract c
       ON c.player_id = s.player_id
      AND c.team_season_id = s.team_season_id
      AND c.superseded_by IS NULL
WHERE c.id IS NULL;


-- ============================================================================
-- SECTION 5 — FRESHNESS AND LEAGUE HEALTH (ALERT / WATCH)
-- Early warning that a league is dying. Cheaper to act on than to autopsy.
-- ============================================================================

-- 5.1 ALERT: games whose window closed with no result and no resolution.
CREATE OR REPLACE VIEW dq.check_stale_windows AS
SELECT g.id AS game_id, g.season_id, g.week_number, g.window_closes_at,
       now() - g.window_closes_at AS overdue_by
FROM game g
WHERE g.status IN ('scheduled','in_window')
  AND g.window_closes_at < now();

-- 5.2 ALERT: results reported but never confirmed by the opponent.
CREATE OR REPLACE VIEW dq.check_pending_confirmations AS
SELECT r.id AS result_id, g.season_id, r.reported_by, r.created_at,
       now() - r.created_at AS pending_for
FROM game_result r
JOIN game g ON g.id = r.game_id
WHERE r.superseded_by IS NULL
  AND r.verified_by IS NULL
  AND r.created_at < now() - INTERVAL '48 hours';

-- 5.3 ALERT: disputes left open. These poison trust fastest of anything here.
CREATE OR REPLACE VIEW dq.check_open_disputes AS
SELECT id AS game_id, season_id, week_number, window_closes_at
FROM game
WHERE status = 'disputed';

-- 5.4 WATCH: GMs with no activity in 14 days — candidates for the seat pool.
CREATE OR REPLACE VIEW dq.check_inactive_gms AS
SELECT ga.user_id, ga.team_season_id, MAX(r.created_at) AS last_report
FROM gm_assignment ga
LEFT JOIN game g ON g.home_team_season_id = ga.team_season_id
                 OR g.away_team_season_id = ga.team_season_id
LEFT JOIN game_result r ON r.game_id = g.id AND r.reported_by = ga.user_id
WHERE ga.ended_at IS NULL
GROUP BY ga.user_id, ga.team_season_id
HAVING MAX(r.created_at) IS NULL OR MAX(r.created_at) < now() - INTERVAL '14 days';

-- 5.5 WATCH: seats open longer than a week — the marketplace is not clearing.
CREATE OR REPLACE VIEW dq.check_unfilled_seats AS
SELECT ts.id AS team_season_id, s.league_id, s.id AS season_id
FROM team_season ts
JOIN season s ON s.id = ts.season_id
WHERE ts.seat_status = 'open'
  AND s.is_active
  AND NOT EXISTS (
      SELECT 1 FROM gm_assignment ga
      WHERE ga.team_season_id = ts.id AND ga.ended_at > now() - INTERVAL '7 days'
  );


-- ============================================================================
-- SECTION 6 — RUNNER
-- Materializes findings. Call from the post-ingest hook and a nightly job.
-- ============================================================================

CREATE OR REPLACE PROCEDURE dq.run_all()
LANGUAGE plpgsql AS $$
DECLARE
    chk RECORD;
    inserted INT;
BEGIN
    FOR chk IN
        SELECT * FROM (VALUES
            ('result_cardinality',       'BLOCK'),
            ('supersede_integrity',      'BLOCK'),
            ('game_sanity',              'BLOCK'),
            ('stat_team_alignment',      'BLOCK'),
            ('gm_uniqueness',            'BLOCK'),
            ('transaction_assets',       'BLOCK'),
            ('standings_arithmetic',     'BLOCK'),
            ('league_goal_balance',      'BLOCK'),
            ('decision_consistency',     'BLOCK'),
            ('goalie_arithmetic',        'BLOCK'),
            ('boxscore_reconciles',      'BLOCK'),
            ('assist_ceiling',           'BLOCK'),
            ('provenance_completeness',  'BLOCK'),
            ('unconfirmed_ocr_counted',  'BLOCK'),
            ('authority_inversion',      'BLOCK'),
            ('supersede_reason',         'BLOCK'),
            ('self_confirmation',        'ALERT'),
            ('unreviewed_conflicts',     'ALERT'),
            ('cap_legality',             'ALERT'),
            ('duplicate_contracts',      'ALERT'),
            ('ineligible_player',        'ALERT'),
            ('stale_windows',            'ALERT'),
            ('pending_confirmations',    'ALERT'),
            ('open_disputes',            'ALERT'),
            ('inactive_gms',             'WATCH'),
            ('unfilled_seats',           'WATCH')
        ) AS t(name, severity)
    LOOP
        EXECUTE format(
            'INSERT INTO dq.finding (check_name, severity, detail)
             SELECT %L, %L, row_to_json(x)::text FROM dq.check_%I x',
            chk.name, chk.severity, chk.name
        );
        GET DIAGNOSTICS inserted = ROW_COUNT;
        RAISE NOTICE 'dq.check_% [%] -> % finding(s)', chk.name, chk.severity, inserted;
    END LOOP;
END;
$$;

-- Publication gate. Call before making an ingest batch visible.
-- Returns TRUE only when no BLOCK-severity finding is open.
CREATE OR REPLACE FUNCTION dq.is_publishable() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM dq.finding
        WHERE severity = 'BLOCK' AND resolved_at IS NULL
    );
$$;
