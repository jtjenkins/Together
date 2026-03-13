ALTER TABLE voice_states
  ADD COLUMN self_video  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN self_screen BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN voice_states.self_video  IS 'User has camera enabled';
COMMENT ON COLUMN voice_states.self_screen IS 'User is sharing their screen';
