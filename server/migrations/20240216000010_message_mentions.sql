-- Add mention tracking columns to messages table.
-- mention_user_ids stores the IDs of server members explicitly @mentioned.
-- mention_everyone is set when the message contains @everyone.

ALTER TABLE messages
  ADD COLUMN mention_user_ids UUID[]   NOT NULL DEFAULT '{}',
  ADD COLUMN mention_everyone  BOOLEAN NOT NULL DEFAULT FALSE;

-- GIN index for efficient containment queries (e.g. "find channels where
-- this user_id appears in mention_user_ids").
CREATE INDEX idx_messages_mention_user ON messages USING GIN (mention_user_ids);
