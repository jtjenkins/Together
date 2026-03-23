-- Migration: Instance-level settings
-- Description: Singleton table for instance configuration (registration mode, etc.)

CREATE TABLE instance_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    registration_mode TEXT NOT NULL DEFAULT 'open'
        CHECK (registration_mode IN ('open', 'invite_only', 'closed')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Insert the default settings row.
INSERT INTO instance_settings (registration_mode) VALUES ('open');
