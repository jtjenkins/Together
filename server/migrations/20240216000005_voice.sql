-- Migration: Voice
-- Description: Voice channel state tracking for WebRTC

-- Voice states table (tracks who's in which voice channel)
CREATE TABLE voice_states (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    self_mute BOOLEAN NOT NULL DEFAULT FALSE,
    self_deaf BOOLEAN NOT NULL DEFAULT FALSE,
    server_mute BOOLEAN NOT NULL DEFAULT FALSE,
    server_deaf BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

-- Index for finding all users in a voice channel
CREATE INDEX idx_voice_states_channel ON voice_states(channel_id);

-- Index for finding which channel a user is in
CREATE INDEX idx_voice_states_user ON voice_states(user_id);

-- Comments for documentation
COMMENT ON TABLE voice_states IS 'Tracks users currently in voice channels';
COMMENT ON COLUMN voice_states.self_mute IS 'User has muted themselves';
COMMENT ON COLUMN voice_states.self_deaf IS 'User has deafened themselves';
COMMENT ON COLUMN voice_states.server_mute IS 'User has been server-muted by moderator';
COMMENT ON COLUMN voice_states.server_deaf IS 'User has been server-deafened by moderator';
COMMENT ON COLUMN voice_states.joined_at IS 'When user joined the voice channel';

-- Note: Actual WebRTC peer connections and audio routing are handled
-- by the voice service in-memory using the Pion WebRTC library.
-- This table only tracks the logical state for persistence and UI display.
