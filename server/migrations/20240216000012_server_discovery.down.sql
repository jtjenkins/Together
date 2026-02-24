DROP INDEX IF EXISTS idx_servers_public;
ALTER TABLE servers DROP COLUMN is_public;
