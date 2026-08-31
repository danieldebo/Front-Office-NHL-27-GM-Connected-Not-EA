-- Migration: password reset tokens for local accounts
-- Depends on: users table (schema.sql >= 1.0.1 / 0001_auth_accounts.sql)

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 64-byte hex token (128 chars). Short-lived + single-use; plaintext is acceptable.
    token       VARCHAR(128) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,           -- set on first use; prevents replay
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);
