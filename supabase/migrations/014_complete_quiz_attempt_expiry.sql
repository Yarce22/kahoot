-- ============================================================
-- Migration 014 — an expired attempt must not complete its assignment
--
-- Migration 013 parameterized new_status on the ATTEMPT update but left the
-- ASSIGNMENT update hardcoded as `SET status = 'completed'`. That was correct
-- while submit was the only caller. It is no longer: the resume path now
-- finalizes a past-due attempt through this same function with
-- new_status = 'expired', and the second statement marked the assignment
-- completed anyway.
--
-- The consequence is compliance-critical and silent. A usuario who abandoned a
-- quiz — possibly with zero answers — showed up on the admin roster
-- (GET /api/assignments?status=completed) as having finished their training,
-- and vanished from ?status=pending, the "who still owes me this" query the
-- roster exists to answer.
--
-- quiz_assignments.status admits only 'pending' and 'completed' (migration
-- 009's CHECK), so there is no third literal to write instead. Nor should
-- there be: an expiry says something about the ATTEMPT, not about whether the
-- obligation was discharged. The obligation was NOT discharged, and 'pending'
-- is already exactly that statement. So the expiry branch leaves
-- quiz_assignments untouched — no status write, no completed_at write, no row
-- lock on it at all. The admin still distinguishes "never started" from
-- "started and ran out" through the per-assignment attemptStatus that
-- GET /api/assignments already derives from the current-cycle attempt row.
--
-- Guarding on new_status = 'completed' (rather than on `new_status <>
-- 'expired'`) keeps the assignment write opt-IN: any future status this
-- function learns to write defaults to leaving the compliance record alone,
-- which is the safe direction for a false-positive-sensitive roster.
--
-- The route stops passing a timestamp as new_submitted_at on the expiry path
-- for the same reason: it was only ever there to feed the completed_at write
-- above, and quiz_attempts.submitted_at is the record of an EXPLICIT submit.
-- attemptEngine's resolveAttemptStatus treats any truthy submittedAt as
-- 'completed', so a stamped submitted_at made the persisted row contradict its
-- own status column. NULL is the honest value, and the column is nullable.
--
-- Signature is unchanged, so CREATE OR REPLACE suffices — no DROP, and every
-- existing caller keeps working.
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
  -- Unchanged from migration 013. Scoped by user_id as well as id (the same
  -- ownership rule the route enforces, re-asserted at the write), and
  -- `AND status = 'in_progress'` makes this the single conditional write that
  -- decides whether the finalization happens at all.
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

  -- ONLY a real submit closes out the assignment. An expiry finalizes the
  -- attempt and leaves the compliance record exactly as it was — see header.
  IF new_status = 'completed' THEN
    -- Cycle-scoped: a stale-cycle submit must not complete a newer cycle's
    -- assignment. Zero matched rows is correct, not an error.
    UPDATE quiz_assignments
       SET status = 'completed',
           completed_at = new_submitted_at
     WHERE id = target_assignment_id
       AND cycle = target_cycle;
  END IF;
END;
$$;

-- Same signature as 013, so PostgREST's cached schema is still accurate; the
-- reload is kept for consistency with 011/012/013 and is harmless.
NOTIFY pgrst, 'reload schema';
