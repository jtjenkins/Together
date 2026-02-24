DROP INDEX IF EXISTS idx_messages_mention_user;

ALTER TABLE messages
  DROP COLUMN IF EXISTS mention_user_ids,
  DROP COLUMN IF EXISTS mention_everyone;
