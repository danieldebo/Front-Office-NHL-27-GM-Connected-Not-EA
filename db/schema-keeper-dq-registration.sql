-- ============================================================================
-- Front Office — wire the keeper DQ checks into dq.run_all()
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1),
--                                        data-quality-checks.sql,
--                                        schema-keepers.sql (>= 1.3.0)
-- Schema version: 2.6.0
--
-- schema-keepers.sql added four dq.check_* views (check_keeper_limit,
-- check_keeper_conflict, check_keeper_origin, check_manual_keeper_matchable)
-- but dq.run_all() — the procedure that actually materializes findings into
-- dq.finding — hardcodes its check list and was never updated to include
-- them. Without this, those four views exist and work standing alone but
-- never feed the DQ findings feed or the publication gate. This delta
-- reissues dq.run_all() with the same body plus the four keeper checks.
--
-- Also adds keeper.id to v_active_keepers: the original view omitted it,
-- which left no way for a client to ever call DELETE /keepers/{id} on a row
-- it can only see through this view.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.6.0', 'Wire the four keeper DQ checks into dq.run_all(); add keeper.id to v_active_keepers');

-- CREATE OR REPLACE VIEW cannot reorder or prepend columns (Postgres only
-- allows appending new ones at the end) — id must be dropped and recreated.
DROP VIEW v_active_keepers;
CREATE VIEW v_active_keepers AS
SELECT
    k.id,
    k.league_id,
    k.season_id,
    k.franchise_id,
    k.player_id,
    p.full_name,
    p.position,
    p.is_manual,
    (p.external_ids ? 'nhl_api')                        AS registry_matched,
    k.first_marked_at,
    k.designated_at,
    k.is_commissioner_override,
    (SELECT COUNT(DISTINCT k2.season_id)
       FROM keeper k2
      WHERE k2.franchise_id = k.franchise_id
        AND k2.player_id = k.player_id)                 AS seasons_kept
FROM keeper k
JOIN player p ON p.id = k.player_id
WHERE k.released_at IS NULL;

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
            ('keeper_limit',             'BLOCK'),
            ('keeper_conflict',          'BLOCK'),
            ('self_confirmation',        'ALERT'),
            ('unreviewed_conflicts',     'ALERT'),
            ('cap_legality',             'ALERT'),
            ('duplicate_contracts',      'ALERT'),
            ('ineligible_player',        'ALERT'),
            ('stale_windows',            'ALERT'),
            ('pending_confirmations',    'ALERT'),
            ('open_disputes',            'ALERT'),
            ('keeper_origin',            'ALERT'),
            ('inactive_gms',             'WATCH'),
            ('unfilled_seats',           'WATCH'),
            ('manual_keeper_matchable',  'WATCH')
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
