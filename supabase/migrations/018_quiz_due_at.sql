-- ============================================================
-- Migration 018 — Quiz due date
--
-- Optional per-quiz deadline. NULL = the quiz never expires. After due_at,
-- usuarios cannot start, resume, answer or submit it (enforced server-side).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ NULL;

NOTIFY pgrst, 'reload schema';
