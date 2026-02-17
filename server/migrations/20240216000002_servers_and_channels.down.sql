-- Revert Migration: Servers and Channels
-- This removes servers, members, and channels

DROP TRIGGER IF EXISTS update_servers_updated_at ON servers;
DROP TABLE IF EXISTS channels;
DROP TABLE IF EXISTS server_members;
DROP TABLE IF EXISTS servers;
