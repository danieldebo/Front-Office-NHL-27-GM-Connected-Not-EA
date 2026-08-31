-- ============================================================================
-- Front Office — box score uploads (CSV or screenshot) with a commissioner
-- review queue
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.7.0
--
-- A GM can attach a box score to a game as either a CSV (parsed into per-
-- player rows server-side) or a screenshot (stored as evidence, score
-- confirmed by a human — this repo has no OCR service wired up, see
-- server/boxScoreParser.ts for the honest accounting of that limitation).
-- Every upload lands in this table with status = 'pending' unless the
-- league has box_score_auto_approve on AND the parsed shape is unambiguous
-- (CSV only — screenshots always require a human to confirm the score).
-- Uploads shaped like a season total rather than a single game are refused
-- at write time (never even reach 'pending') by application-layer parsing,
-- not a DB constraint, since "season-total-shaped" is a heuristic over the
-- parsed rows rather than a fixed column check.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.7.0', 'Box score upload queue: CSV/screenshot uploads, commissioner approve/reject, auto-approve setting');

ALTER TABLE league
    ADD COLUMN box_score_auto_approve BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE box_score_upload (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id                  UUID NOT NULL REFERENCES game(id),
    league_id                UUID NOT NULL REFERENCES league(id),
    uploaded_by              UUID REFERENCES app_user(id),
    kind                     TEXT NOT NULL CHECK (kind IN ('csv', 'screenshot')),
    raw_payload              TEXT NOT NULL,
    parsed_home_goals        INT,
    parsed_away_goals        INT,
    parsed_rows              JSONB NOT NULL DEFAULT '[]'::jsonb,
    status                   TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected')),
    auto_approved            BOOLEAN NOT NULL DEFAULT FALSE,
    rejection_reason         TEXT,
    reviewed_by              UUID REFERENCES app_user(id),
    reviewed_at              TIMESTAMPTZ,
    resulting_game_result_id UUID REFERENCES game_result(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status = 'pending' OR reviewed_at IS NOT NULL),
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);
CREATE INDEX ON box_score_upload (league_id, status);
CREATE INDEX ON box_score_upload (game_id);
