-- Per-user read position for both server channels and DM channels.
-- `channel_id` is a UUID that references either `channels.id` or
-- `direct_message_channels.id`; no FK constraint is used here so that a
-- single table handles both namespaces without needing nullable dual-FK columns.
-- Application code is responsible for validating that channel_id exists in the
-- appropriate table before upserting a read state.
CREATE TABLE channel_read_states (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID        NOT NULL,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX read_states_user_idx ON channel_read_states (user_id);
