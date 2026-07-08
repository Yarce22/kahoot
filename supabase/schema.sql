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
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- quizzes
CREATE TABLE quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) <= 200),
  description TEXT,
  owner_id UUID NOT NULL REFERENCES admins(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- questions
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('open', 'closed', 'true_false')),
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
  quiz_id UUID NOT NULL REFERENCES quizzes(id),
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

-- Race-safe admin role/status update (see migration 005). Serializes
-- concurrent changes with an advisory lock so the system can never be left
-- with zero active superadmins. Raises 'admin_not_found' / 'last_active_superadmin'.
CREATE OR REPLACE FUNCTION update_admin_role_status(
  target_id uuid,
  new_role text DEFAULT NULL,
  new_active boolean DEFAULT NULL
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
         is_active = COALESCE(new_active, is_active)
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
