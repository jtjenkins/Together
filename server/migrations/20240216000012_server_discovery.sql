ALTER TABLE servers
  ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_servers_public
  ON servers(is_public, created_at DESC)
  WHERE is_public = TRUE;

-- Make the seed Gaming Squad server browsable
UPDATE servers SET is_public = TRUE WHERE id = '00000000-0000-0000-0000-000000000100';
