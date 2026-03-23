-- Migration: User disabled flag
-- Description: Allow instance admins to disable user accounts

ALTER TABLE users ADD COLUMN disabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN disabled_at TIMESTAMPTZ;
