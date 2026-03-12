-- Migration: Pinned Messages
-- Adds the ability to pin messages in a channel.

ALTER TABLE messages
    ADD COLUMN pinned     BOOLEAN    NOT NULL DEFAULT FALSE,
    ADD COLUMN pinned_by  UUID       REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN pinned_at  TIMESTAMPTZ;

-- Index for efficient retrieval of all pinned messages in a channel.
CREATE INDEX idx_messages_pinned
    ON messages(channel_id, pinned_at DESC)
    WHERE pinned = TRUE AND deleted = FALSE;
