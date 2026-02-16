-- Migration: Messages
-- Description: Chat messages with full-text search and attachments

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
    edited_at TIMESTAMPTZ,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical index for message pagination (most important query pattern)
CREATE INDEX idx_messages_channel_time
    ON messages(channel_id, created_at DESC)
    WHERE deleted = FALSE;

-- Index for finding messages by author
CREATE INDEX idx_messages_author
    ON messages(author_id, created_at DESC)
    WHERE deleted = FALSE;

-- Index for reply threads
CREATE INDEX idx_messages_reply_to ON messages(reply_to)
    WHERE reply_to IS NOT NULL AND deleted = FALSE;

-- Full-text search index (GIN index for PostgreSQL full-text search)
CREATE INDEX idx_messages_search
    ON messages USING GIN(to_tsvector('english', content))
    WHERE deleted = FALSE;

-- Reactions table
CREATE TABLE reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);

-- Index for finding all reactions on a message
CREATE INDEX idx_reactions_message ON reactions(message_id);

-- Attachments table
CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    url TEXT NOT NULL,
    width INT,
    height INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_file_size CHECK (file_size > 0 AND file_size <= 52428800) -- 50MB max
);

-- Index for finding attachments by message
CREATE INDEX idx_attachments_message ON attachments(message_id);

-- Index for finding images (for gallery views)
CREATE INDEX idx_attachments_images ON attachments(message_id, created_at DESC)
    WHERE mime_type LIKE 'image/%';

-- Comments for documentation
COMMENT ON TABLE messages IS 'Chat messages with soft delete support';
COMMENT ON TABLE reactions IS 'Emoji reactions on messages (Discord-style)';
COMMENT ON TABLE attachments IS 'File attachments on messages';
COMMENT ON COLUMN messages.content IS 'Message text content (supports markdown)';
COMMENT ON COLUMN messages.reply_to IS 'Optional message ID this is replying to';
COMMENT ON COLUMN messages.deleted IS 'Soft delete flag (preserves history)';
COMMENT ON COLUMN reactions.emoji IS 'Unicode emoji or custom emoji ID';
COMMENT ON COLUMN attachments.url IS 'File storage path or URL';
COMMENT ON COLUMN attachments.width IS 'Image/video width in pixels (if applicable)';
COMMENT ON COLUMN attachments.height IS 'Image/video height in pixels (if applicable)';
