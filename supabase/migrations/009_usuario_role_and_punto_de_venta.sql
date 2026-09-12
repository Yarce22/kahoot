-- ============================================================
-- Migration 009 — usuario accounts, punto de venta, async quiz attempts
--
-- Adds a second account kind as its own `users` table rather than a new
-- admins.role value: a usuario must never be able to own a quiz
-- (quizzes.owner_id REFERENCES admins) nor be counted by the
-- update_admin_role_status last-active-superadmin guard (migration 005).
-- Also adds the store dimension (punto_de_venta), quiz-to-user assignments
-- and PIN-less asynchronous attempts. Live PIN mode (game_sessions, players,
-- player_answers, questions.time_limit_seconds) is untouched.
--
-- admins.punto_de_venta lands NULLABLE here ON PURPOSE: existing admin rows
-- have no correct value and must be backfilled by hand with their real
-- store. There is no safe default — guessing one would silently mis-scope
-- every store-filtered query for that admin. Migration 010 flips the column
-- to NOT NULL and refuses to run while any row is still NULL.
--
-- Additive and idempotent — safe to re-run.
-- ============================================================

-- 1. Store dimension on admins. The CHECK tolerates NULL so it can be
--    installed now instead of waiting for the backfill; migration 010
--    tightens it.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS punto_de_venta TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admins_punto_de_venta_check') THEN
    ALTER TABLE admins ADD CONSTRAINT admins_punto_de_venta_check
      CHECK (punto_de_venta IS NULL OR punto_de_venta IN
        ('Cerritos', 'Campestre', 'Centenario', 'Circunvalar', 'Laureles'));
  END IF;
END $$;

-- 2. usuario accounts. Mirrors admins' bcrypt-hash + is_active soft-delete
--    shape (a hard delete would orphan assignments/attempts). punto_de_venta
--    is NOT NULL from the start — there are no pre-existing rows to backfill.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  punto_de_venta TEXT NOT NULL CHECK (punto_de_venta IN
    ('Cerritos', 'Campestre', 'Centenario', 'Circunvalar', 'Laureles')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_punto_de_venta ON users(punto_de_venta);

-- 3. Async-only quiz fields. total_time_seconds NULL = this quiz cannot be
--    assigned asynchronously (assignment creation rejects it). The
--    per-question questions.time_limit_seconds stays untouched and
--    live-mode-only; async ignores it entirely. assignment_cycle is the
--    quiz-level high-water mark used to seed new assignments and bumped on
--    every reactivation.
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS total_time_seconds INT;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS assignment_cycle INT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_total_time_seconds_check') THEN
    ALTER TABLE quizzes ADD CONSTRAINT quizzes_total_time_seconds_check
      CHECK (total_time_seconds IS NULL OR total_time_seconds BETWEEN 60 AND 7200);
  END IF;
END $$;

-- 4. quiz <-> user assignments. UNIQUE (quiz_id, user_id) keeps exactly one
--    live row per pair: a reactivation advances `cycle` in place instead of
--    inserting a duplicate, so the roster never grows a second row per user.
CREATE TABLE IF NOT EXISTS quiz_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cycle INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  assigned_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (quiz_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_assignments_user_status ON quiz_assignments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_quiz_assignments_quiz_status ON quiz_assignments(quiz_id, status);

-- 5. Attempts. UNIQUE (assignment_id, cycle) is what enforces "one attempt
--    per assignment per cycle" as a DATABASE invariant rather than app
--    logic — a double-fired start loses at the constraint, not at a
--    race-prone read-then-write check. quiz_id/user_id are denormalized off
--    the assignment so the admin history can filter by user/quiz/store
--    without extra joins. There is deliberately NO pass/fail column: the
--    product has no passing threshold, only correct_count/total_questions/
--    score_percent. expires_at snapshots started_at + time_budget_seconds so
--    editing the quiz mid-attempt can neither shorten nor extend it.
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES quiz_assignments(id) ON DELETE CASCADE,
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cycle INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'expired')),
  time_budget_seconds INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  total_questions INT,
  correct_count INT,
  score_percent INT,
  UNIQUE (assignment_id, cycle)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz ON quiz_attempts(quiz_id, status);

-- 6. Per-question answers. Mirrors player_answers' conventions verbatim so
--    the scoring helpers stay reusable: for type 'multiple' the picks are
--    stored as comma-joined option TEXTS in answer_text with
--    selected_option_id NULL (an FK column cannot hold several ids).
--    UNIQUE (attempt_id, question_id) makes the per-answer write an upsert,
--    so a usuario can change an answer before submitting.
CREATE TABLE IF NOT EXISTS quiz_attempt_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_text TEXT,
  selected_option_id UUID REFERENCES answer_options(id) ON DELETE SET NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  time_taken_ms INT,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempt_answers_attempt ON quiz_attempt_answers(attempt_id);

-- 7. Reactivation, atomically. Bumping the quiz high-water mark and
--    re-cycling its assignments are two statements and supabase-js has no
--    client-side transaction, so they live in one function — same shape as
--    update_admin_role_status (migration 005), advisory lock keyed per quiz
--    so two concurrent reactivations can't hand out the same cycle.
--    scope_punto_de_venta NULL = superadmin (every assignment on the quiz);
--    a value = that store only, which is the defense-in-depth re-filter for
--    non-superadmins (a superadmin may have created cross-store assignments
--    on this quiz that a store admin must not touch).
CREATE OR REPLACE FUNCTION reactivate_quiz_assignments(
  target_quiz_id uuid,
  target_user_ids uuid[] DEFAULT NULL,
  scope_punto_de_venta text DEFAULT NULL
)
RETURNS TABLE (assignment_id uuid, new_cycle int)
LANGUAGE plpgsql
AS $$
DECLARE
  next_cycle INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('quiz_assignment_cycle:' || target_quiz_id::text));

  UPDATE quizzes
     SET assignment_cycle = assignment_cycle + 1
   WHERE id = target_quiz_id
  RETURNING assignment_cycle INTO next_cycle;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quiz_not_found';
  END IF;

  -- In-progress attempts are intentionally NOT force-expired: they keep
  -- their old cycle, finish normally, and stay queryable as history.
  RETURN QUERY
  UPDATE quiz_assignments a
     SET cycle = next_cycle,
         status = 'pending',
         completed_at = NULL
    FROM users u
   WHERE a.user_id = u.id
     AND a.quiz_id = target_quiz_id
     AND (target_user_ids IS NULL OR a.user_id = ANY(target_user_ids))
     AND (scope_punto_de_venta IS NULL OR u.punto_de_venta = scope_punto_de_venta)
  RETURNING a.id, a.cycle;
END;
$$;
