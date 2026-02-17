-- Revert Migration: Users and Auth
-- This removes the users and sessions tables

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
