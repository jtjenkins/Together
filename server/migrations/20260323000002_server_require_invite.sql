-- Migration: Server require-invite flag
-- Description: Allow public servers to require an invite code for joining

ALTER TABLE servers ADD COLUMN require_invite BOOLEAN NOT NULL DEFAULT false;
