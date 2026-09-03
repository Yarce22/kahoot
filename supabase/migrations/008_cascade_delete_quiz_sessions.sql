-- ============================================================
-- Migration 008 — cascade-delete game_sessions with their quiz
--
-- game_sessions.quiz_id had no ON DELETE action, so DELETE
-- /api/quizzes/:id 500'd with a foreign key violation for any quiz that
-- had ever been played (even finished sessions) — it only guarded against
-- lobby/active sessions, not the FK itself. Sessions/players/player_answers
-- have no meaning once their quiz is gone, so cascade them, matching
-- questions.quiz_id which already cascades. Downstream players/
-- player_answers already cascade off game_sessions/players, so this alone
-- closes the gap.
-- ============================================================

ALTER TABLE game_sessions
  DROP CONSTRAINT game_sessions_quiz_id_fkey,
  ADD CONSTRAINT game_sessions_quiz_id_fkey
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
