-- Rollback: Remove bio and pronouns fields from users
ALTER TABLE users
  DROP COLUMN IF EXISTS bio,
  DROP COLUMN IF EXISTS pronouns;
