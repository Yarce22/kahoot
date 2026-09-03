-- ============================================================
-- Migration 007 — Password reset tokens
--
-- Adds a scoped forgot-password / reset-password flow for admins. Raw
-- reset tokens are never persisted — only a SHA-256 hex digest
-- (token_hash), so a database read alone can never be used to reset an
-- admin's password. `used_at` prevents a token from being replayed once
-- consumed.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_admin ON password_reset_tokens(admin_id);
