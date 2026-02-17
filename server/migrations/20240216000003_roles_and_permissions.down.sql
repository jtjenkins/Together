-- Revert Migration: Roles and Permissions
-- This removes the permission system

DROP TABLE IF EXISTS channel_permission_overrides;
DROP TABLE IF EXISTS member_roles;
DROP TABLE IF EXISTS roles;
