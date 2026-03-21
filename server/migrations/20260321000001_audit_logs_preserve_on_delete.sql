-- Migration: Preserve audit logs when servers are deleted
--
-- Changes server_id from ON DELETE CASCADE to ON DELETE SET NULL so that
-- audit records survive server deletion. Audit logs should outlive the
-- entities they describe — a deleted server is the most important event
-- to have an audit trail for.

ALTER TABLE audit_logs
    ALTER COLUMN server_id DROP NOT NULL;

ALTER TABLE audit_logs
    DROP CONSTRAINT audit_logs_server_id_fkey,
    ADD CONSTRAINT audit_logs_server_id_fkey
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL;
