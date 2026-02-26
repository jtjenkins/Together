-- Add thread_id column to messages so replies can be grouped into threads.
-- Thread replies reference the root message; only root messages (thread_id IS NULL)
-- appear in the main channel list.

ALTER TABLE messages
  ADD COLUMN thread_id UUID REFERENCES messages(id) ON DELETE CASCADE;

-- Partial index for fast thread-reply lookups: filters out root messages and
-- soft-deleted rows, ordered oldest-first (thread reads top-to-bottom).
CREATE INDEX idx_messages_thread
  ON messages(thread_id, created_at ASC)
  WHERE thread_id IS NOT NULL AND deleted = FALSE;
