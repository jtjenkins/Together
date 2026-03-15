-- Migration: Add bio and pronouns fields to users
-- Description: Extends user profiles with bio (free-form text) and pronouns fields

ALTER TABLE users
  ADD COLUMN bio      TEXT,
  ADD COLUMN pronouns TEXT;

COMMENT ON COLUMN users.bio      IS 'Optional free-form user biography (max 500 characters enforced at app layer)';
COMMENT ON COLUMN users.pronouns IS 'Optional pronouns string, e.g. "they/them" (max 40 characters enforced at app layer)';
