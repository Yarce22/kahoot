-- ============================================================
-- Migration 013 — submitting an attempt is ONE transaction
--
-- POST /api/user/attempts/:id/submit finishes an attempt by writing two
-- different tables: the attempt's own totals + status, and the assignment's
-- status/completed_at. Those were two independent, unguarded, sequential
-- supabase-js `.update()` calls with no transaction and no compensation.
--
-- If the second one failed, the attempt was already durably 'completed' while
-- the assignment stayed 'pending' — and the client's own retry was then
-- rejected by the FIRST write's ATTEMPT_ALREADY_SUBMITTED guard, so there was
-- no client-driven recovery path at all. The usuario appears to the admin
-- roster as never having taken the quiz, permanently.
--
-- supabase-js has no client-side transactions. This codebase already solves
-- exactly this class of problem the same way — update_admin_role_status
-- (migration 005) and reactivate_quiz_assignments (migration 009, whose header
-- says so explicitly) — so the two writes move into one plpgsql function and
-- become atomic by construction: a failure rolls both back and the retry finds
-- the attempt still 'in_progress'.
--
-- No advisory lock here, unlike reactivate_quiz_assignments. That function has
-- to serialize a read-modify-write of a shared counter (quizzes.assignment_cycle);
-- this one only touches rows keyed by a single attempt, and the
-- `AND status = 'in_progress'` predicate on the attempt UPDATE is itself the
-- serialization point — the row lock makes a concurrent second submit find zero
-- rows and raise, rather than double-writing.
--
-- target_cycle is a PARAMETER rather than being read back from the attempt
-- row, because the route must read the attempt anyway (for quiz_id/expires_at,
-- to grade it) and the guard is then observable at the route boundary, which
-- is the only layer the server test suite can exercise (there is no live test
-- database — see server/test/README.md). It cannot go stale: nothing in the
-- codebase ever UPDATEs quiz_attempts.cycle. The attempt UPDATE re-asserts it
-- anyway, so a mismatched value fails the whole call instead of silently
-- completing the wrong assignment.
--
-- The cycle scope on the ASSIGNMENT update is the point of that parameter: a
-- reactivation bumps the assignment to a new cycle while deliberately leaving
-- in-progress attempts on their old one (see the comment in
-- reactivate_quiz_assignments), so submitting a stale-cycle attempt must never
-- mark the CURRENT cycle completed. Zero matched rows there is the correct
-- outcome, not an error.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION complete_quiz_attempt(
  target_attempt_id uuid,
  target_user_id uuid,
  target_cycle int,
  new_status text,
  new_submitted_at timestamptz,
  new_total_questions int,
  new_correct_count int,
  new_score_percent int
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target_assignment_id uuid;
BEGIN
  -- Scoped by user_id as well as id: the same ownership rule the route
  -- enforces, re-asserted at the write so the function is safe on its own.
  -- `AND status = 'in_progress'` makes this the single conditional write that
  -- decides whether the submit happens at all.
  UPDATE quiz_attempts
     SET status = new_status,
         submitted_at = new_submitted_at,
         total_questions = new_total_questions,
         correct_count = new_correct_count,
         score_percent = new_score_percent
   WHERE id = target_attempt_id
     AND user_id = target_user_id
     AND cycle = target_cycle
     AND status = 'in_progress'
  RETURNING assignment_id INTO target_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt_not_in_progress';
  END IF;

  -- Cycle-scoped: a stale-cycle submit must not complete a newer cycle's
  -- assignment. Zero matched rows is correct, not an error.
  UPDATE quiz_assignments
     SET status = 'completed',
         completed_at = new_submitted_at
   WHERE id = target_assignment_id
     AND cycle = target_cycle;
END;
$$;

-- PostgREST caches the schema, and this is a NEW function, so the reload is
-- required rather than merely consistent with 011/012.
NOTIFY pgrst, 'reload schema';
