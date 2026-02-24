-- Direct Message channels: a shared conversation space between exactly two users.
-- Messages are stored in `direct_messages` (separate from server messages) so
-- no server_id FK is needed and DM history is not affected by server deletion.

CREATE TABLE direct_message_channels (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL    DEFAULT NOW()
);

-- Both participants of a DM channel.
-- Unique pair enforcement is handled at the application layer: before inserting
-- a new channel, query for an existing one shared by both user IDs.
CREATE TABLE direct_message_members (
    channel_id UUID NOT NULL REFERENCES direct_message_channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id)                    ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX dm_members_user_idx ON direct_message_members (user_id);

-- Messages in DM channels.  Mirrors the structure of the server `messages`
-- table but without channel_id FK to `channels` (to avoid a cross-table
-- ambiguity) and without reply threading for the MVP.
CREATE TABLE direct_messages (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID        NOT NULL REFERENCES direct_message_channels(id) ON DELETE CASCADE,
    author_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
    content    TEXT        NOT NULL,
    edited_at  TIMESTAMPTZ,
    deleted    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX direct_messages_channel_idx
    ON direct_messages (channel_id, created_at DESC, id DESC);
