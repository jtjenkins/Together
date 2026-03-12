-- Migration: Add is_admin flag to users
-- Grants admin to the earliest-registered user (first to sign up on self-hosted instance).

ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

UPDATE users
SET is_admin = true
WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1);
