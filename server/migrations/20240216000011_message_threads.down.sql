DROP INDEX IF EXISTS idx_messages_thread;

ALTER TABLE messages DROP COLUMN IF EXISTS thread_id;
