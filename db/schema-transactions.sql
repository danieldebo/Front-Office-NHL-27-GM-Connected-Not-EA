-- ============================================================================
-- Front Office — transactions engine schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1),
--                                        migration-2.0.0-league-settings.sql
-- Schema version: 2.4.0
--
-- Build-queue prompt C: the real system behind the Wire panel. schema.sql
-- already modeled transaction_event / transaction_asset / transaction_approval
-- and a v_cap_position view — this delta adds the few pieces that were
-- missing: per-league trade/waiver policy, a roster status a contract can
-- carry (active / IR / minors), the waiver claim-window record itself, and a
-- league-level Discord webhook URL for the four events prompt C calls out.
--
-- Deliberately NOT added here: a dedicated transaction type for GM seat
-- changes. gm_assignment already append-only-logs every seat change with
-- who/when/why; a parallel transaction_event row would just be a second,
-- easy-to-desync copy of the same fact.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.4.0', 'Transactions engine: trade/waiver policy, contract roster status, waiver table, Discord webhook URL');

-- ---------------------------------------------------------------------------
-- League policy: how much this league automates the transaction flow.
-- ---------------------------------------------------------------------------

ALTER TABLE league_settings_version
  ADD COLUMN IF NOT EXISTS auto_approve_trades BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cap_enforcement TEXT NOT NULL DEFAULT 'warn',
  ADD COLUMN IF NOT EXISTS waiver_window_hours INT NOT NULL DEFAULT 24;

ALTER TABLE league_settings_version
  DROP CONSTRAINT IF EXISTS league_settings_version_cap_enforcement_check;
ALTER TABLE league_settings_version
  ADD CONSTRAINT league_settings_version_cap_enforcement_check
    CHECK (cap_enforcement IN ('block', 'warn', 'off'));

ALTER TABLE league_settings_version
  DROP CONSTRAINT IF EXISTS league_settings_version_waiver_window_hours_check;
ALTER TABLE league_settings_version
  ADD CONSTRAINT league_settings_version_waiver_window_hours_check
    CHECK (waiver_window_hours BETWEEN 1 AND 168);

-- ---------------------------------------------------------------------------
-- Roster status: where a signed player currently sits. Contract rows are
-- otherwise an append-only ownership ledger (a new row supersedes the old
-- one on every trade/signing/release); roster status is cheap, frequently
-- toggled operational state, so it is updated in place on the current
-- (superseded_by IS NULL) row rather than forcing a new contract row per
-- IR/minors toggle.
-- ---------------------------------------------------------------------------

ALTER TABLE contract
  ADD COLUMN IF NOT EXISTS roster_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE contract
  DROP CONSTRAINT IF EXISTS contract_roster_status_check;
ALTER TABLE contract
  ADD CONSTRAINT contract_roster_status_check
    CHECK (roster_status IN ('active', 'ir', 'minors'));

-- ---------------------------------------------------------------------------
-- Waivers: a released player is claimable for a window before clearing to
-- free agency outright. Multiple waiver_claim transaction_event rows can
-- reference one waiver; resolution executes the winning claim (by reverse
-- standings, per prompt C) and rejects the rest.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS waiver (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id                UUID NOT NULL REFERENCES league(id),
    season_id                UUID NOT NULL REFERENCES season(id),
    player_id                UUID NOT NULL REFERENCES player(id),
    waived_by_team_season_id UUID NOT NULL REFERENCES team_season(id),
    release_txn_id           UUID NOT NULL REFERENCES transaction_event(id),
    opened_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at               TIMESTAMPTZ NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'open',
    winning_txn_id           UUID REFERENCES transaction_event(id),
    resolved_at              TIMESTAMPTZ,
    CHECK (status IN ('open', 'resolved', 'withdrawn')),
    CHECK (expires_at > opened_at)
);
CREATE INDEX IF NOT EXISTS waiver_open_idx ON waiver (season_id, status) WHERE status = 'open';

ALTER TABLE transaction_event
  ADD COLUMN IF NOT EXISTS waiver_id UUID REFERENCES waiver(id);

-- ---------------------------------------------------------------------------
-- Discord webhook: league-level delivery target for the four transaction
-- events prompt C calls out (trade_proposed, trade_executed, signing,
-- waiver_claim). No prior webhook plumbing existed anywhere in the codebase
-- to reuse, contrary to the prompt's assumption — this is new.
-- ---------------------------------------------------------------------------

ALTER TABLE league
  ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
