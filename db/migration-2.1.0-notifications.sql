-- Task 61: durable multi-channel domain-event notifications.
BEGIN;

CREATE TABLE IF NOT EXISTS notification_preference (
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    in_app BOOLEAN NOT NULL DEFAULT TRUE,
    email BOOLEAN NOT NULL DEFAULT FALSE,
    daily_digest BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, event_type),
    CHECK (length(btrim(event_type)) > 0),
    CHECK (NOT daily_digest OR email)
);

CREATE TABLE IF NOT EXISTS notification_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    league_id UUID REFERENCES league(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS notification_item_user_created
    ON notification_item (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_item_user_unread
    ON notification_item (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS discord_webhook (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES league(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url_ciphertext BYTEA NOT NULL,
    url_iv BYTEA NOT NULL,
    url_auth_tag BYTEA NOT NULL,
    event_filters TEXT[] NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    failure_count INT NOT NULL DEFAULT 0,
    disabled_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES app_user(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (cardinality(event_filters) > 0)
);
CREATE INDEX IF NOT EXISTS discord_webhook_league ON discord_webhook (league_id);

CREATE OR REPLACE FUNCTION enforce_discord_webhook_limit() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.league_id::text, 0));
  IF (SELECT count(*) FROM discord_webhook WHERE league_id = NEW.league_id) >= 5 THEN
    RAISE EXCEPTION 'a league may have at most five Discord webhooks'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS discord_webhook_limit ON discord_webhook;
CREATE TRIGGER discord_webhook_limit
BEFORE INSERT ON discord_webhook
FOR EACH ROW EXECUTE FUNCTION enforce_discord_webhook_limit();

CREATE TABLE IF NOT EXISTS notification_delivery_job (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL,
    outbox_id BIGINT REFERENCES outbox(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'discord')),
    user_id UUID REFERENCES app_user(id) ON DELETE CASCADE,
    webhook_id UUID REFERENCES discord_webhook(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'retry', 'sent', 'failed', 'digest_pending')),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    CHECK ((channel = 'discord') = (webhook_id IS NOT NULL)),
    CHECK (channel = 'discord' OR user_id IS NOT NULL)
);
ALTER TABLE notification_delivery_job
    ADD COLUMN IF NOT EXISTS claim_token UUID,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS notification_delivery_job_dedupe
    ON notification_delivery_job
    (event_id, channel, COALESCE(user_id::text, webhook_id::text));
CREATE INDEX IF NOT EXISTS notification_delivery_job_pending
    ON notification_delivery_job (next_attempt_at) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS notification_delivery_job_claimable
    ON notification_delivery_job (status, next_attempt_at, lease_expires_at)
    WHERE status IN ('pending', 'retry', 'digest_pending');

CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe_key_unique ON outbox (dedupe_key);
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS outbox_notification_pending
    ON outbox (next_attempt_at)
    WHERE processed_at IS NULL AND dead_lettered_at IS NULL;

INSERT INTO schema_version (version, notes)
VALUES ('2.1.0', 'Durable notification inbox, preferences, delivery jobs, and encrypted Discord webhooks')
ON CONFLICT (version) DO NOTHING;

COMMIT;