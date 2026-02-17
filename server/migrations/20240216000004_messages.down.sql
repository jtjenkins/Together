-- Revert Migration: Messages
-- This removes messages, reactions, and attachments

DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS reactions;
DROP TABLE IF EXISTS messages;
