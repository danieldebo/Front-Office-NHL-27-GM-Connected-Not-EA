-- Migration: multi-provider auth accounts
-- Apply with: psql $DATABASE_URL -f lib/db/migrations/0001_auth_accounts.sql
-- Or via drizzle-kit: pnpm --filter @workspace/db run push
--
-- This migration adds:
--   1. psn_gamertag varchar to users (display-only; Sony has no public OAuth)
--   2. auth_accounts table — links external OAuth identities and local passwords
--      to internal user rows

-- ── Step 1: extend users table ───────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS psn_gamertag varchar;

-- ── Step 2: create auth_accounts table ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_accounts (
  id                  varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             varchar      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'google' | 'microsoft' | 'discord' | 'local'
  provider            varchar(20)  NOT NULL,
  -- External user-id from the provider; NULL for local accounts
  provider_account_id varchar,
  -- bcrypt hash; only populated for provider = 'local'
  password_hash       varchar,
  created_at          timestamptz  NOT NULL DEFAULT now()
);

-- One account per provider per user (e.g. one local, one google, ...)
CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_userid_provider_uq
  ON auth_accounts (user_id, provider);

-- Unique external identity per provider — prevents duplicate OAuth linkage
-- under concurrent first-login races.  NULLs are distinct in Postgres so
-- multiple local rows (provider_account_id = NULL) do not conflict here;
-- their uniqueness is enforced by the (user_id, provider) index above.
CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_provider_pid_uq
  ON auth_accounts (provider, provider_account_id);
