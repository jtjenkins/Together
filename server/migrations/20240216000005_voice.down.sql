-- Revert Migration: Voice
-- This removes voice state tracking

DROP TABLE IF EXISTS voice_states;
