-- ============================================================
-- Migration 017 — Usuario password reset tokens
--
-- Mirrors migration 007 for usuarios (table `users`). Raw reset tokens are
-- never persisted — only a SHA-256 hex digest (token_hash). `used_at`
-- prevents a token from being replayed once consumed.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_password_reset_tokens_user ON user_password_reset_tokens(user_id);

-- RLS on with no policies: the anon/authenticated roles PostgREST exposes can
-- neither read nor plant token rows (planting a known token_hash for a victim
-- user_id would be an account takeover). The server uses the secret key, which
-- bypasses RLS, so its own reads/writes are unaffected.
ALTER TABLE user_password_reset_tokens ENABLE ROW LEVEL SECURITY;
