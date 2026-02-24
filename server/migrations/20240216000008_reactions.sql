-- Emoji reactions on server channel messages.
-- Each (message, user, emoji) triple is unique — a user cannot add the same
-- emoji twice to the same message.  Reactions are deleted when the message is
-- hard-deleted (ON DELETE CASCADE); soft-deleted messages keep their reactions
-- until a hard delete or explicit cleanup.
CREATE TABLE message_reactions (
    message_id UUID        NOT NULL REFERENCES messages(id)  ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    emoji      TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX reactions_message_idx ON message_reactions (message_id);
