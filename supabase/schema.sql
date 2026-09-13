-- ============================================================
-- Kahoot MVP — Supabase Schema
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor)
-- ============================================================

-- admins
-- NOTE: new admins default to role='admin'. On a fresh install there is no
-- superadmin until you promote one — and admin management is superadmin-only,
-- so bootstrap the first one by hand after creating it:
--   UPDATE admins SET role = 'superadmin'
--   WHERE id = (SELECT id FROM admins ORDER BY created_at ASC, id ASC LIMIT 1);
-- (The migration path handles this automatically — see migration 004.)
-- punto_de_venta is NOT NULL here (final state, post migration 010) — on a
-- fresh install every admin is created with a real store from day one, so
-- there is no backfill window to represent.
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  punto_de_venta TEXT NOT NULL CHECK (punto_de_venta IN
    ('Cerritos', 'Campestre', 'Centenario', 'Circunvalar', 'Laureles')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- quizzes
-- total_time_seconds NULL = this quiz cannot be assigned asynchronously
-- (see migration 009); the per-question time_limit_seconds below stays
-- live-PIN-mode-only and is unaffected. assignment_cycle is the quiz-level
-- high-water mark bumped on every reactivation (see reactivate_quiz_assignments).
CREATE TABLE quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) <= 200),
  description TEXT,
  owner_id UUID NOT NULL REFERENCES admins(id),
  total_time_seconds INT CHECK (total_time_seconds IS NULL OR total_time_seconds BETWEEN 60 AND 7200),
  assignment_cycle INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- questions
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('open', 'closed', 'true_false', 'multiple')),
  time_limit_seconds INT NOT NULL DEFAULT 30 CHECK (time_limit_seconds BETWEEN 5 AND 120),
  order_index INT NOT NULL DEFAULT 0
);

-- answer_options (closed questions only)
CREATE TABLE answer_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false
);

-- game_sessions
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  pin VARCHAR(6) NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'active', 'finished')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Partial unique index: PINs only unique among active sessions
CREATE UNIQUE INDEX sessions_pin_active_idx ON game_sessions(pin) WHERE status IN ('lobby', 'active');

-- players
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  score INT NOT NULL DEFAULT 0,
  total_time_ms INT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT now()
);

-- player_answers
CREATE TABLE player_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_text TEXT,                   -- open questions
  selected_option_id UUID REFERENCES answer_options(id),  -- closed questions
  answered_at TIMESTAMPTZ DEFAULT now(),
  time_taken_ms INT NOT NULL DEFAULT 0,
  is_correct BOOLEAN                  -- null for open questions
);

-- Useful indexes
CREATE INDEX idx_game_sessions_pin ON game_sessions(pin);
CREATE INDEX idx_players_session ON players(session_id);
CREATE INDEX idx_player_answers_player ON player_answers(player_id);
CREATE INDEX idx_player_answers_question ON player_answers(question_id);
CREATE INDEX idx_questions_quiz ON questions(quiz_id, order_index);
CREATE INDEX idx_quizzes_owner ON quizzes(owner_id);

-- ============================================================
-- Password reset tokens (see migration 007)
--
-- Scoped forgot-password / reset-password flow for admins. Raw reset
-- tokens are never persisted — only a SHA-256 hex digest (token_hash), so
-- a database read alone can never be used to reset an admin's password.
-- `used_at` prevents a token from being replayed once consumed.
-- ============================================================
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_admin ON password_reset_tokens(admin_id);

-- Race-safe admin role/status update (see migration 005). Serializes
-- concurrent changes with an advisory lock so the system can never be left
-- with zero active superadmins. Raises 'admin_not_found' / 'last_active_superadmin'.
-- new_punto_de_venta is part of the signature here (final state, post migration
-- 011): PATCH /api/admins/:id ALWAYS calls this RPC with all four named
-- arguments, so a database provisioned from the 3-argument version would fail
-- every role/is_active PATCH with PGRST202. NULL means "leave unchanged"
-- (COALESCE), exactly like new_role and new_active — the column is NOT NULL, so
-- the function can never be used to blank it.
CREATE OR REPLACE FUNCTION update_admin_role_status(
  target_id uuid,
  new_role text DEFAULT NULL,
  new_active boolean DEFAULT NULL,
  new_punto_de_venta text DEFAULT NULL
)
RETURNS admins
LANGUAGE plpgsql
AS $$
DECLARE
  result admins;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('admins_role_guard'));

  UPDATE admins
     SET role = COALESCE(new_role, role),
         is_active = COALESCE(new_active, is_active),
         punto_de_venta = COALESCE(new_punto_de_venta, punto_de_venta)
   WHERE id = target_id
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM admins WHERE role = 'superadmin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'last_active_superadmin';
  END IF;

  RETURN result;
END;
$$;

-- ============================================================
-- Usuario accounts, punto de venta scoping, async quiz attempts
-- (see migration 009 / migration 010)
--
-- A usuario is a distinct account kind, not an admins.role value: it must
-- never own a quiz (quizzes.owner_id references admins only) nor be counted
-- by the last-active-superadmin guard above. Live PIN mode (game_sessions,
-- players, player_answers, questions.time_limit_seconds) is completely
-- untouched by this section.
-- ============================================================

-- usuario accounts. Mirrors admins' bcrypt-hash + is_active soft-delete
-- shape (a hard delete would orphan assignments/attempts).
CREATE TABLE users (
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

CREATE INDEX idx_users_punto_de_venta ON users(punto_de_venta);

-- quiz <-> user assignments. UNIQUE (quiz_id, user_id) keeps exactly one
-- live row per pair — a reactivation advances `cycle` in place instead of
-- inserting a duplicate.
CREATE TABLE quiz_assignments (
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

CREATE INDEX idx_quiz_assignments_user_status ON quiz_assignments(user_id, status);
CREATE INDEX idx_quiz_assignments_quiz_status ON quiz_assignments(quiz_id, status);

-- Attempts. UNIQUE (assignment_id, cycle) enforces "one attempt per
-- assignment per cycle" as a DATABASE invariant. No pass/fail column exists
-- anywhere — only correct_count/total_questions/score_percent. expires_at
-- snapshots started_at + time_budget_seconds so a mid-attempt quiz edit can
-- neither shorten nor extend it.
CREATE TABLE quiz_attempts (
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

CREATE INDEX idx_quiz_attempts_user ON quiz_attempts(user_id, status);
CREATE INDEX idx_quiz_attempts_quiz ON quiz_attempts(quiz_id, status);

-- Per-question answers. Mirrors player_answers' conventions verbatim so the
-- scoring helpers stay reusable: for type 'multiple' the picks are stored as
-- comma-joined option TEXTS in answer_text with selected_option_id NULL.
-- UNIQUE (attempt_id, question_id) makes the per-answer write an upsert.
CREATE TABLE quiz_attempt_answers (
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

CREATE INDEX idx_quiz_attempt_answers_attempt ON quiz_attempt_answers(attempt_id);

-- Reactivation, atomically (see migration 009). Bumping the quiz high-water
-- mark and re-cycling its assignments are two statements and supabase-js has
-- no client-side transaction, so they live in one advisory-locked function.
-- scope_punto_de_venta NULL = superadmin (every assignment on the quiz); a
-- value = that store only (defense-in-depth re-filter for non-superadmins).
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
