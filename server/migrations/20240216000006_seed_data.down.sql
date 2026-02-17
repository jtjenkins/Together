-- Revert Migration: Seed Data
-- This removes all seed data (safe - only test data)

-- Delete seed data in reverse dependency order
DELETE FROM reactions WHERE message_id IN (
    SELECT id FROM messages
    WHERE author_id IN (
        SELECT id FROM users WHERE email LIKE '%@together.local'
    )
);

DELETE FROM messages WHERE author_id IN (
    SELECT id FROM users WHERE email LIKE '%@together.local'
);

DELETE FROM member_roles WHERE server_id IN (
    SELECT id FROM servers WHERE name = 'Gaming Squad'
);

DELETE FROM roles WHERE server_id IN (
    SELECT id FROM servers WHERE name = 'Gaming Squad'
);

DELETE FROM channels WHERE server_id IN (
    SELECT id FROM servers WHERE name = 'Gaming Squad'
);

DELETE FROM server_members WHERE server_id IN (
    SELECT id FROM servers WHERE name = 'Gaming Squad'
);

DELETE FROM servers WHERE name = 'Gaming Squad';

DELETE FROM users WHERE email LIKE '%@together.local';
